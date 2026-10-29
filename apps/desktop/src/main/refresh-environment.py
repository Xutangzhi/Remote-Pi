"""Run over SSH stdin; only Pi Web's proxy overrides are changed."""
import fcntl
import json
import os
import pwd
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

KEYS = ('http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'ftp_proxy',
        'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'FTP_PROXY')
UNITS = ('pi-web-sessiond.service', 'pi-web.service')
PREFIX = 'REMOTE_PI_ENV '


def emit(phase, message):
    try:
        print(PREFIX + json.dumps({'phase': phase, 'message': message}, ensure_ascii=False), flush=True)
    except BrokenPipeError:
        pass  # Finish the transaction even if the desktop connection closes.


def systemctl(*args):
    return subprocess.run(['systemctl', '--user'] + list(args), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=40, check=True).stdout.decode().strip()


def read_proxy():
    shell = pwd.getpwuid(os.getuid()).pw_shell or '/bin/bash'
    clean = {key: value for key, value in os.environ.items() if key not in KEYS}
    result = subprocess.run([shell, '-lic', '/usr/bin/env -0'], env=clean,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=20, check=True)
    values = {}
    for item in result.stdout.split(b'\0'):
        key, _, value = item.partition(b'=')
        name = key.decode('utf-8', 'replace')
        if name in KEYS and value:
            values[name] = value.decode('utf-8')
    for key, value in values.items():
        if len(value) > 8192 or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise RuntimeError('代理变量含无效字符，未修改服务。')
        if key.lower() != 'no_proxy':
            url = urllib.parse.urlsplit(value)
            if url.scheme not in ('http', 'https', 'socks5', 'socks5h') or not url.hostname:
                raise RuntimeError('新终端的代理地址格式无效，未修改服务。')
            try:
                with socket.create_connection((url.hostname, url.port or (443 if url.scheme == 'https' else 1080 if url.scheme.startswith('socks') else 80)), timeout=5):
                    pass
            except (OSError, ValueError):
                raise RuntimeError('新终端配置的代理端口无法连接，未修改服务。') from None
    return values


def override(values):
    def quote(value):
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
    # Remove stale inherited/drop-in values that the new terminal no longer exports.
    lines = ['# Managed by Remote Pi: latest interactive login shell proxy', '[Service]']
    missing = [key for key in KEYS if key not in values]
    if missing:
        lines.append('UnsetEnvironment=' + ' '.join(missing))
    lines += ['Environment=' + quote(key + '=' + value) for key, value in values.items()]
    return ('\n'.join(lines) + '\n').encode('utf-8')


def atomic_write(path, content):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=str(path.parent), prefix='.remote-pi-')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, str(path))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def check_idle(read_json):
    status = read_json('/api/machines/local/status')
    if not isinstance(status, dict):
        raise RuntimeError('无法确认任务状态，未重启服务。')
    sessions = status.get('sessions')
    epoch = status.get('epochId')
    revision = status.get('revision')
    machine = status.get('machine', {})
    unattributed = status.get('unattributed', {})
    if (not isinstance(epoch, str) or not epoch.strip() or type(revision) is not int or revision < 0
            or not isinstance(sessions, dict)
            or any(not isinstance(item, dict) or any(not isinstance(flag, bool) for flag in item.values())
                   for item in [*sessions.values(), machine, unattributed])):
        raise RuntimeError('无法确认任务状态，未重启服务。')
    # Pi Web publishes sparse flags: an omitted working flag means false.
    if any(item.get('core:working', False) for item in [*sessions.values(), machine, unattributed]):
        raise RuntimeError('有对话或子任务正在执行，请等任务结束后再刷新远端环境。')


def is_service_process(process, main_pid):
    if process.name == main_pid:
        return True
    try:
        command = (Path('/proc') / main_pid / 'cmdline').read_bytes().split(b'\0')
        # sg keeps a launcher parent; its direct Node child is the daemon itself.
        return (command[:2] == [b'/usr/bin/sg', b'docker']
                and (process / 'comm').read_text().strip() == 'node'
                and any(line.split()[1] == main_pid for line in (process / 'status').read_text().splitlines() if line.startswith('PPid:')))
    except OSError:
        return False


def check_background_processes():
    # systemd's control-group stop also kills detached terminals/proxy clients.
    groups = []
    for unit in UNITS:
        group = systemctl('show', unit, '--property=ControlGroup', '--value')
        pid = systemctl('show', unit, '--property=MainPID', '--value')
        if not group or not pid.isdigit() or int(pid) <= 0:
            raise RuntimeError('无法确认远端服务进程，未重启服务。')
        groups.append((group, pid))
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            paths = [line.split(':', 2)[-1] for line in (process / 'cgroup').read_text().splitlines()]
        except FileNotFoundError:
            continue  # A short-lived process exited during the scan.
        except PermissionError:
            # Fail closed for this user's processes; other users cannot be unit children.
            if process.stat().st_uid == os.getuid():
                raise RuntimeError('无法检查服务下的后台进程，未重启服务。') from None
            continue
        if any(any(path == group or path.startswith(group + '/') for path in paths) and not is_service_process(process, pid) for group, pid in groups):
            raise RuntimeError('Pi Web 服务下仍有终端或后台进程，重启会一起关闭它们。请先退出终端，或将代理和后台任务移到独立服务后再刷新。')


def daemon_pid(main_pid):
    command = (Path('/proc') / str(main_pid) / 'cmdline').read_bytes().split(b'\0')
    if command[:2] != [b'/usr/bin/sg', b'docker']:
        return main_pid
    children = [int(process.name) for process in Path('/proc').iterdir()
                if process.name.isdigit() and process.name != str(main_pid) and is_service_process(process, str(main_pid))]
    if len(children) != 1:
        raise RuntimeError('Docker 组启动器下的 Node 守护进程尚未就绪。')
    return children[0]


def wait_healthy(read_json, expected=None):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        try:
            if read_json('/api/sessiond/health').get('ok') is not True:
                raise RuntimeError('sessiond unavailable')
            read_json('/api/machines/local/status')
            for unit in UNITS:
                pid = int(systemctl('show', unit, '--property=MainPID', '--value'))
                if pid <= 0:
                    raise RuntimeError('service inactive')
                if expected is not None:
                    actual_pid = daemon_pid(pid)
                    if actual_pid != pid:
                        # /proc access also requires matching the daemon's primary GID.
                        raw = subprocess.run(['/usr/bin/sg', 'docker', '-c', 'exec /usr/bin/cat /proc/{}/environ'.format(actual_pid)],
                                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=True).stdout
                    else:
                        raw = Path('/proc/{}/environ'.format(pid)).read_bytes()
                    entries = raw.split(b'\0')
                    actual = dict(item.split(b'=', 1) for item in entries if b'=' in item)
                    if any(actual.get(key.encode(), b'').decode() != expected.get(key, '') for key in KEYS):
                        raise RuntimeError('proxy mismatch')
            return
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            time.sleep(0.5)
    raise RuntimeError('服务健康或代理环境检查未通过。')


def refresh(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def read_json(path):
        with opener.open('http://127.0.0.1:{}{}'.format(port, path), timeout=3) as response:
            return json.load(response)
    emit('checking', '正在检查远端服务和运行中的任务…')
    for unit in UNITS:
        if systemctl('show', unit, '--property=LoadState', '--value') != 'loaded':
            raise RuntimeError('需要已安装的 Pi Web 和 sessiond systemd 用户服务。')
    check_idle(read_json)
    check_background_processes()
    emit('reading', '正在从新的登录终端读取代理配置…')
    values = read_proxy()
    config = Path(os.environ.get('XDG_CONFIG_HOME') or str(Path.home() / '.config')) / 'systemd/user'
    originals = []
    restarting = False
    try:
        check_idle(read_json)
        emit('syncing', '正在同步 {} 项代理变量…{}'.format(len(values), '' if values else '新终端未设置代理，将使用直连。'))
        for unit in UNITS:
            path = config / (unit + '.d') / 'zz-remote-pi-environment.conf'
            original = path.read_bytes() if path.exists() else None
            if original is not None:
                backup = path.with_name(path.name + '.backup-' + str(time.time_ns()))
                atomic_write(backup, original)
            originals.append((path, original))
            atomic_write(path, override(values))
        systemctl('daemon-reload')
        check_idle(read_json)
        check_background_processes()
        emit('restarting', '正在重启 Pi Web 和 sessiond…')
        restarting = True
        systemctl('restart', *UNITS)
        emit('verifying', '正在检查服务健康及实际进程代理环境…')
        wait_healthy(read_json, values)
    except Exception as reason:
        if originals:
            emit('rollback', '刷新未完成，正在恢复之前的代理配置…')
            rollback_blocked = False
            try:
                for path, original in originals:
                    if original is None:
                        path.unlink(missing_ok=True)
                    else:
                        atomic_write(path, original)
                systemctl('daemon-reload')
                if restarting:
                    # New work may have started while health verification was running.
                    try:
                        check_idle(read_json)
                        check_background_processes()
                    except Exception:
                        rollback_blocked = True
                    if not rollback_blocked:
                        systemctl('restart', *UNITS)
                        wait_healthy(read_json)
            except Exception:
                raise RuntimeError('刷新失败，自动恢复服务未通过检查；请在服务器检查两个 Pi Web 用户服务。') from None
            if rollback_blocked:
                raise RuntimeError('刷新失败，已恢复之前的代理配置；无法确认任务和后台进程全部空闲，已保留当前运行服务，未再次重启。请等待所有任务和终端空闲后重新刷新以应用配置。') from None
            if not restarting and isinstance(reason, RuntimeError):
                raise RuntimeError(str(reason) + ' 已恢复之前的代理配置。') from None
            raise RuntimeError('刷新失败，已恢复之前的代理配置和服务。') from None
        raise
    emit('done', '远端环境已刷新 · 已同步 {} 项代理变量，服务健康检查通过。'.format(len(values)))


def main():
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    try:
        port = int(sys.argv[1])
        if not 1 <= port <= 65535:
            raise ValueError('port')
        lock_path = Path.home() / '.cache/remote-pi/environment-refresh.lock'
        lock_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with lock_path.open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('另一个远端环境刷新正在进行，请稍后重试。') from None
            refresh(port)
    except RuntimeError as error:
        emit('error', str(error))
        return 1
    except Exception:
        emit('error', '无法刷新远端环境，请检查 SSH、Python 3 和 systemd 用户服务是否可用。')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
