import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).parents[1] / 'src/main/refresh-environment.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class EnvironmentTests(unittest.TestCase):
    def test_proxy_snapshot_uses_a_new_interactive_login_and_never_copies_other_secrets(self):
        completed = Mock(stdout=b'API_KEY=private\0https_proxy=http://user:secret@localhost:7892\0no_proxy=localhost\0')
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://old:7890'}), patch.object(r.subprocess, 'run', return_value=completed) as run, patch.object(r.socket, 'create_connection', return_value=contextlib.nullcontext()):
            values = r.read_proxy()
        self.assertEqual(set(values), {'https_proxy', 'no_proxy'})
        self.assertEqual(run.call_args.args[0][1:], ['-lic', '/usr/bin/env -0'])
        self.assertNotIn('HTTPS_PROXY', run.call_args.kwargs['env'])

    def test_override_escapes_systemd_specifiers_quotes_and_removes_old_missing_keys(self):
        text = r.override({'https_proxy': 'http://a%25:b\\"@localhost:7892'}).decode()
        self.assertIn('a%%25:b\\\\\\"', text)
        self.assertIn('UnsetEnvironment=http_proxy', text)
        self.assertNotIn('UnsetEnvironment=\n', text)  # Preserve unrelated user unset rules.
        self.assertIn('HTTP_PROXY', text)
        self.assertNotIn('UnsetEnvironment=', r.override(dict.fromkeys(r.KEYS, 'value')).decode())

    def test_invalid_or_unreachable_proxy_is_rejected_before_writing(self):
        for value in (b'http://localhost:7892\nEnvironment=INJECTED=yes', b'file:///tmp/proxy', b'http://localhost:99999'):
            with self.subTest(value=value), patch.object(r.subprocess, 'run', return_value=Mock(stdout=b'http_proxy=' + value + b'\0')):
                with self.assertRaises(RuntimeError):
                    r.read_proxy()
        with patch.object(r.subprocess, 'run', return_value=Mock(stdout=b'http_proxy=http://localhost:7892\0')), patch.object(r.socket, 'create_connection', side_effect=OSError('private proxy password')):
            with self.assertRaisesRegex(RuntimeError, '端口无法连接'):
                r.read_proxy()

    def transaction(self, *, fail=False, busy=False, late_busy=False, rollback_idle_error=None, rollback_background_error=None):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'systemd/user'
            original = config / (r.UNITS[0] + '.d') / 'zz-remote-pi-environment.conf'
            r.atomic_write(original, b'previous override\n')
            sibling = original.parent / 'proxy.conf'
            sibling.write_text('user configuration')
            paths = [config / (unit + '.d') / 'zz-remote-pi-environment.conf' for unit in r.UNITS]
            seen = []
            def control(*args):
                seen.append(args)
                return 'loaded'
            idle_calls = []
            def check_idle(_read):
                idle_calls.append(True)
                if busy or (late_busy and len(idle_calls) == 3):
                    raise RuntimeError('有对话或子任务正在执行')
                if len(idle_calls) == 4 and rollback_idle_error is not None:
                    raise rollback_idle_error
            background_calls = []
            def check_background():
                background_calls.append(True)
                if len(background_calls) == 3 and rollback_background_error is not None:
                    raise rollback_background_error
            health = Mock(side_effect=[RuntimeError('bad health'), None] if fail else None)
            output = io.StringIO()
            with patch.dict(os.environ, {'XDG_CONFIG_HOME': directory}), patch.object(r, 'systemctl', side_effect=control), patch.object(r, 'check_idle', side_effect=check_idle), patch.object(r, 'check_background_processes', side_effect=check_background), patch.object(r, 'read_proxy', return_value={'http_proxy': 'http://user:private@localhost:7892'}), patch.object(r, 'wait_healthy', health), contextlib.redirect_stdout(output):
                if fail or busy or late_busy:
                    with self.assertRaises(RuntimeError) as raised:
                        r.refresh(8504)
                else:
                    r.refresh(8504)
            self.assertEqual(sibling.read_text(), 'user configuration')
            self.assertNotIn('private', output.getvalue())
            self.assertNotIn('user:', output.getvalue())
            rollback_blocked = rollback_idle_error is not None or rollback_background_error is not None
            self.assertEqual([item for item in seen if item[0] == 'restart'], [] if busy or late_busy else [('restart', *r.UNITS)] * (2 if fail and not rollback_blocked else 1))
            if rollback_blocked:
                self.assertIn('已恢复之前的代理配置', str(raised.exception))
                self.assertIn('未再次重启', str(raised.exception))
                self.assertIn('空闲', str(raised.exception))
                self.assertNotIn('private', str(raised.exception))
                self.assertEqual(seen[-1], ('daemon-reload',))
                self.assertEqual(seen.count(('daemon-reload',)), 2)
                health.assert_called_once()
            if fail or busy or late_busy:
                self.assertEqual(original.read_bytes(), b'previous override\n')
                self.assertFalse(paths[1].exists())
            else:
                for path in paths:
                    self.assertIn(b'localhost:7892', path.read_bytes())
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(len(list(original.parent.glob('*.backup-*'))), 1)
                health.assert_called_once()
                self.assertEqual(health.call_args.args[1], {'http_proxy': 'http://user:private@localhost:7892'})
                self.assertIn('"phase": "done"', output.getvalue())

    def test_success_updates_both_services_and_backs_up_own_override(self):
        self.transaction()

    def test_failed_health_restores_both_original_files_and_restarts_previous_config(self):
        self.transaction(fail=True)

    def test_busy_task_changes_nothing(self):
        self.transaction(busy=True)

    def test_task_starting_during_refresh_restores_config_without_restarting(self):
        self.transaction(late_busy=True)

    def test_task_starting_after_restart_blocks_rollback_restart(self):
        self.transaction(fail=True, rollback_idle_error=RuntimeError('有对话或子任务正在执行'))

    def test_terminal_starting_after_restart_blocks_rollback_restart(self):
        self.transaction(fail=True, rollback_background_error=RuntimeError('Pi Web 服务下仍有终端或后台进程'))

    def test_unknown_task_or_process_state_blocks_rollback_restart(self):
        for field, error in [('rollback_idle_error', OSError('private HTTP failure')),
                             ('rollback_idle_error', RuntimeError('无法确认任务状态')),
                             ('rollback_background_error', PermissionError('private process failure'))]:
            with self.subTest(field=field, error=type(error).__name__):
                self.transaction(fail=True, **{field: error})

    def test_idle_check_fails_closed_on_unknown_status(self):
        for value in ({}, {'sessions': []}, {'sessions': {'id': {}}}, {'sessions': {'id': {'core:working': True}}}, {'sessions': {}, 'unattributed': {'core:working': True}}, {'sessions': {}, 'machine': {'core:working': True}}):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                r.check_idle(lambda _: value)
        r.check_idle(lambda _: {'epochId': 'test', 'revision': 1, 'sessions': {'id': {'core:working': False}}})
        r.check_idle(lambda _: {'epochId': 'test', 'revision': 2, 'sessions': {'id': {'core:unread': True}, 'idle': {}}})
        with self.assertRaisesRegex(RuntimeError, '有对话或子任务'):
            r.check_idle(lambda _: {'epochId': 'test', 'revision': 3, 'sessions': {'idle': {}, 'active': {'core:working': True}}})

    def test_idle_check_rejects_invalid_metadata(self):
        valid = {'epochId': 'test', 'revision': 0, 'sessions': {}}
        invalid = [None, [], True]
        invalid += [dict(valid, epochId=value) for value in (None, '', '  ', 1)]
        invalid += [dict(valid, revision=value) for value in (None, True, False, -1, 1.5, '1')]
        for status in invalid:
            with self.subTest(status=status), self.assertRaisesRegex(RuntimeError, '无法确认任务状态'):
                r.check_idle(lambda _: status)
        r.check_idle(lambda _: valid)

    def test_idle_check_validates_flags_in_every_scope(self):
        for scope in ('sessions', 'machine', 'unattributed'):
            def status(flags):
                value = {'epochId': 'test', 'revision': 1, 'sessions': {}}
                value[scope] = {'id': flags} if scope == 'sessions' else flags
                return value
            for flags in (None, [], False, {'core:working': 0}, {'core:working': ''},
                          {'core:working': None}, {'core:unread': 0}):
                with self.subTest(scope=scope, flags=flags), self.assertRaisesRegex(RuntimeError, '无法确认任务状态'):
                    r.check_idle(lambda _: status(flags))
            for flags in ({}, {'core:working': False}, {'core:unread': True}):
                with self.subTest(scope=scope, flags=flags):
                    r.check_idle(lambda _: status(flags))
            with self.subTest(scope=scope), self.assertRaisesRegex(RuntimeError, '有对话或子任务'):
                r.check_idle(lambda _: status({'core:working': True}))

    def test_health_checks_actual_process_environment_for_both_services(self):
        data = {'/api/sessiond/health': {'ok': True}, '/api/machines/local/status': {'sessions': {}}}
        with patch.object(r, 'systemctl', return_value='123') as control, patch.object(Path, 'read_bytes', return_value=b'http_proxy=http://localhost:7892\0PRIVATE=secret\0'):
            r.wait_healthy(data.get, {'http_proxy': 'http://localhost:7892'})
            self.assertEqual(control.call_count, 2)
        with patch.object(r, 'systemctl', return_value='123'), patch.object(Path, 'read_bytes', return_value=b'http_proxy=http://old:7890\0'), patch.object(r.time, 'monotonic', side_effect=[0, 1, 41]), patch.object(r.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, '代理环境检查未通过'):
                r.wait_healthy(data.get, {'http_proxy': 'http://localhost:7892'})

    def test_detached_proxy_or_terminal_inside_service_group_blocks_restart(self):
        for pid, group, blocked in [('100', '/pi-web.service', False), ('150', '/pi-web.service', True), ('150', '/pi-web.service/child', True), ('150', '/independent-proxy.service', False)]:
            process = Mock()
            process.name = pid
            process.__truediv__ = Mock(return_value=Mock(read_text=Mock(return_value='0::' + group)))
            with self.subTest(pid=pid, group=group), patch.object(r, 'systemctl', side_effect=['/pi-web.service', '100', '/sessiond.service', '200']), patch.object(Path, 'iterdir', return_value=[process]):
                if blocked:
                    with self.assertRaisesRegex(RuntimeError, '终端或后台进程'):
                        r.check_background_processes()
                else:
                    r.check_background_processes()

    def test_sg_docker_direct_node_child_is_daemon_but_other_children_are_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            process = Path(directory) / '200'
            process.mkdir()
            for command, name, parent, expected in [(b'/usr/bin/sg\0docker\0-c\0command\0', 'node', '100', True), (b'/usr/bin/sg\0docker\0', 'bash', '100', False), (b'/usr/bin/sg\0docker\0', 'node', '999', False), (b'/usr/bin/node\0', 'node', '100', False)]:
                (process / 'comm').write_text(name)
                (process / 'status').write_text('PPid:\t' + parent + '\n')
                with self.subTest(command=command, name=name, parent=parent), patch.object(Path, 'read_bytes', return_value=command):
                    self.assertEqual(r.is_service_process(process, '100'), expected)

    def test_environment_verification_reads_node_child_instead_of_privileged_sg_parent(self):
        child = Mock(name='node')
        child.name = '200'
        with patch.object(Path, 'read_bytes', return_value=b'/usr/bin/sg\0docker\0'), patch.object(Path, 'iterdir', return_value=[child]), patch.object(r, 'is_service_process', return_value=True):
            self.assertEqual(r.daemon_pid(100), 200)
        with patch.object(Path, 'read_bytes', return_value=b'/usr/bin/node\0'):
            self.assertEqual(r.daemon_pid(100), 100)
        with patch.object(Path, 'read_bytes', return_value=b'/usr/bin/sg\0docker\0'), patch.object(Path, 'iterdir', return_value=[]):
            with self.assertRaises(RuntimeError):
                r.daemon_pid(100)

    def test_group_launched_daemon_environment_is_read_with_matching_docker_gid(self):
        data = {'/api/sessiond/health': {'ok': True}, '/api/machines/local/status': {'sessions': {}}}
        with patch.object(r, 'systemctl', return_value='100'), patch.object(r, 'daemon_pid', return_value=200), patch.object(r.subprocess, 'run', return_value=Mock(stdout=b'http_proxy=http://localhost:7893\0')) as run:
            r.wait_healthy(data.get, {'http_proxy': 'http://localhost:7893'})
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args.args[0], ['/usr/bin/sg', 'docker', '-c', 'exec /usr/bin/cat /proc/200/environ'])


if __name__ == '__main__':
    unittest.main()
