import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { get } from 'node:http';
import { EventEmitter } from 'node:events';
import { validateProfile } from './profiles';
import type { ConnectionState, EnvironmentRefresh, ServerProfile } from '../shared/types';

function connectionArguments(profile: ServerProfile): string[] {
  const args = ['-T', '-o', 'StrictHostKeyChecking=ask', '-o', 'ConnectTimeout=20'];
  if (profile.port !== null) args.push('-p', String(profile.port));
  if (profile.username) args.push('-l', profile.username);
  if (profile.identityFile) args.push('-i', profile.identityFile);
  args.push(profile.host);
  return args;
}

export function sshArguments(profile: ServerProfile, localPort: number): string[] {
  return ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${profile.remotePort}`, ...connectionArguments(profile)];
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function probePiWeb(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = get(url, { timeout: 1500 }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => { if (body.length < 131072) body += chunk.toString(); });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode === 401 || response.statusCode === 403) reject(new Error('Pi Web 需要额外的 HTTP 认证，请使用直接监听的本机端口。'));
        else if (response.statusCode !== 200 || !/pi-web|pi web/i.test(body)) reject(new Error('该端口没有返回 Pi Web 页面，请核对远端端口。'));
        else resolve();
      });
    });
    request.on('timeout', () => request.destroy(new Error('等待 Pi Web 响应超时。')));
    request.on('error', reject);
  });
}

interface TunnelOptions { askpassPath: string; askpassPort: number; askpassToken: string; executable?: string; extraEnvironment?: NodeJS.ProcessEnv; knownHostsFile?: string; }

export class TunnelManager extends EventEmitter {
  state: ConnectionState = { phase: 'idle', message: '尚未连接服务器' };
  private child?: ChildProcess;
  private generation = 0;
  private ports = new Map<string, number>();
  constructor(private readonly options: TunnelOptions) { super(); }
  private environment(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.options.extraEnvironment,
      SSH_ASKPASS: this.options.askpassPath, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: process.env.DISPLAY || ':0',
      REMOTE_PI_ASKPASS_PORT: String(this.options.askpassPort), REMOTE_PI_ASKPASS_TOKEN: this.options.askpassToken,
      ELECTRON_RUN_AS_NODE: '1' };
  }
  private knownHosts(args: string[]): string[] {
    if (this.options.knownHostsFile) args.unshift('-o', `UserKnownHostsFile=${this.options.knownHostsFile}`, '-o', 'GlobalKnownHostsFile=/dev/null');
    return args;
  }
  async refreshEnvironment(input: unknown, script: string, progress: (state: EnvironmentRefresh) => void): Promise<string> {
    const profile = validateProfile(input);
    const args = this.knownHosts(['-o', 'NumberOfPasswordPrompts=1', ...connectionArguments(profile), `python3 - ${profile.remotePort}`]);
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.executable ?? 'ssh', args, { env: this.environment(), stdio: 'pipe', windowsHide: true });
      let pending = ''; let result: EnvironmentRefresh | undefined;
      const timeout = setTimeout(() => child.kill(), 300_000);
      child.stdin.on('error', () => {});
      child.stderr.on('data', () => {}); // SSH/shell output can contain credentials; never forward it.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        pending += chunk;
        const lines = pending.split('\n'); pending = lines.pop()!.slice(-16384);
        for (const line of lines) {
          if (!line.startsWith('REMOTE_PI_ENV ')) continue;
          try {
            const state = JSON.parse(line.slice(14)) as EnvironmentRefresh;
            if (!['checking', 'reading', 'syncing', 'restarting', 'verifying', 'rollback', 'done', 'error'].includes(state.phase) || typeof state.message !== 'string' || state.message.length > 1000) continue;
            result = state;
            if (state.phase !== 'done' && state.phase !== 'error') progress(state);
          } catch {}
        }
      });
      child.once('error', () => { clearTimeout(timeout); reject(new Error('无法启动 SSH 环境刷新命令。')); });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 && result?.phase === 'done') resolve(result.message);
        else reject(new Error(result?.phase === 'error' ? result.message : '远端环境刷新命令未完成，请检查 SSH 验证及远端服务状态。'));
      });
      child.stdin.end(script);
    });
  }
  private update(state: ConnectionState): void { this.state = state; this.emit('state', state); }
  authenticating(): void {
    if (this.child && this.state.phase !== 'connected') this.update({ ...this.state, phase: 'authenticating', message: '等待 SSH 身份验证' });
  }
  async connect(input: unknown): Promise<string | null> {
    const profile = validateProfile(input);
    await this.disconnect();
    const generation = ++this.generation;
    this.update({ phase: 'connecting', profileId: profile.id, message: '正在建立 SSH 加密连接…' });
    const localPort = this.ports.get(profile.id) ?? await availablePort();
    if (generation !== this.generation) return null;
    this.ports.set(profile.id, localPort);
    const env = this.environment();
    const args = this.knownHosts(sshArguments(profile, localPort));
    const child = spawn(this.options.executable ?? 'ssh', args, {
      env, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    });
    this.child = child;
    let diagnostic = '';
    child.stderr!.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-6000); });
    const failed = (message: string) => {
      if (generation !== this.generation || this.child !== child) return;
      this.child = undefined;
      this.update({ phase: 'error', profileId: profile.id, errorCode: 'ssh', message });
    };
    child.on('error', (error) => failed(`无法启动系统 OpenSSH：${error.message}`));
    child.on('exit', (code, signal) => {
      if (this.state.phase === 'connected') failed('SSH 连接已断开。远端任务仍由服务器管理，点击重新连接即可返回。');
      else failed(diagnostic.trim() || `SSH 连接结束（${signal ?? code ?? 'unknown'}）。`);
    });
    const url = `http://127.0.0.1:${localPort}/`;
    const deadline = Date.now() + 150_000;
    let serviceStartedAt = 0;
    let lastError = '';
    while (generation === this.generation && this.child === child && Date.now() < deadline) {
      try {
        await probePiWeb(url);
        if (generation !== this.generation || this.child !== child) return null;
        this.update({ phase: 'connected', profileId: profile.id, connectedAt: Date.now(), message: 'SSH 已连接 · Pi Web 就绪' });
        return url;
      } catch (error) {
        lastError = (error as Error).message;
        // SSH opens its local listener after authentication. A reset or remote
        // channel refusal means login succeeded but the target service is absent.
        if (/connect failed:|open failed:/.test(diagnostic) || !/ECONNREFUSED/.test(lastError)) {
          serviceStartedAt ||= Date.now();
          if (this.state.phase !== 'authenticating') this.update({ phase: 'checking', profileId: profile.id, message: 'SSH 已连接，正在等待远端 Pi Web…' });
          if (Date.now() - serviceStartedAt > 10_000) break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (generation !== this.generation || !this.child) return null;
    await this.stopChild();
    this.update({ phase: 'error', profileId: profile.id, errorCode: 'service', message: serviceStartedAt
      ? `SSH 已登录，但无法访问服务器的 127.0.0.1:${profile.remotePort}。请检查 Pi Web 是否启动及端口是否正确。${lastError.includes('HTTP') ? ` ${lastError}` : ''}`
      : 'SSH 连接超时。请检查服务器地址、网络以及是否完成身份验证。' });
    return null;
  }
  async disconnect(): Promise<void> {
    this.generation++;
    await this.stopChild();
    this.update({ phase: 'idle', message: '连接已关闭 · 远端任务继续运行' });
  }
  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || !child.pid) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid!, 'SIGKILL'); } catch {}
        resolve();
      }, 1200);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid!, 'SIGTERM'); }
      catch { clearTimeout(timeout); resolve(); }
    });
  }
}
