import { EventEmitter } from 'node:events';
import { posix } from 'node:path';
import type { FileSuggestion, PiOperation, SessionRef, SessionEvent, TerminalPacket, TranscriptSnapshot, WorkspacePacket } from '../shared/pi';

const prefix = '/api/machines/local';
const encoded = (value: unknown, label: string): string => encodeURIComponent(text(value, label, 4096));
function text(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0')) throw new Error(`${label}无效。`);
  return value;
}
const refFrom = (input: Record<string, unknown>): SessionRef => ({ id: text(input.id, '会话 ID', 512), cwd: text(input.cwd, '工作目录') });
const sessionPath = (ref: SessionRef, endpoint: string) => `${prefix}/sessions/${encodeURIComponent(ref.id)}/${endpoint}`;
const withCwd = (path: string, cwd: string, extra: Record<string, string> = {}) => `${path}?${new URLSearchParams({ cwd, ...extra })}`;
const workspacePath = (input: Record<string, unknown>) => `${prefix}/projects/${encoded(input.projectId, '项目 ID')}/workspaces/${encoded(input.workspaceId, '工作区 ID')}`;
// Pi Web proxies can relay JSON as binary frames. ArrayBuffer decoding is
// synchronous, so transcript events retain their arrival order.
const parseSocketFrame = (data: string | ArrayBuffer) => JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));

export class PiClient extends EventEmitter {
  private baseURL?: string;
  private lifetime = new AbortController();
  private watch?: { id: string; session: SessionRef; controller: AbortController; socket?: WebSocket; timer?: NodeJS.Timeout };
  private terminal?: { id: string; socket?: WebSocket; controller: AbortController };
  private plugins?: { id: string; backendRevision?: string; pairedRequestVersion?: number; pairedChannelVersion?: number }[];
  private globalSocket?: WebSocket;
  private globalRetry?: NodeJS.Timeout;

  connect(url: string): void {
    this.disconnect();
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Pi Web 必须通过本地 SSH 隧道访问。');
    this.baseURL = parsed.origin;
    this.lifetime = new AbortController();
    this.startCatalogStream();
  }
  disconnect(): void {
    this.lifetime.abort();
    this.unwatch(); this.detachTerminal();
    clearTimeout(this.globalRetry);
    const socket = this.globalSocket; this.globalSocket = undefined; socket?.close();
    this.baseURL = undefined; this.plugins = undefined;
  }
  get url(): string | undefined { return this.baseURL; }
  private startCatalogStream(): void {
    if (!this.baseURL) return;
    const socket = new WebSocket(`${this.baseURL.replace('http:', 'ws:')}${prefix}/events`);
    socket.binaryType = 'arraybuffer';
    this.globalSocket = socket;
    socket.addEventListener('open', () => { if (socket === this.globalSocket) this.packet({ type: 'catalog', event: { type: 'catalog.connected' } }); });
    socket.addEventListener('message', (event) => {
      if (socket !== this.globalSocket) return;
      try { this.packet({ type: 'catalog', event: parseSocketFrame(event.data) }); } catch {}
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => {
      if (this.globalSocket === socket && !this.lifetime.signal.aborted) this.globalRetry = setTimeout(() => this.startCatalogStream(), 3000);
    });
  }

  private async http<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, timeoutMs = 30_000): Promise<T> {
    if (!this.baseURL) throw new Error('请先连接 SSH 服务器。');
    const response = await fetch(`${this.baseURL}${path}`, {
      method, redirect: 'error', headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    });
    const content = await response.text();
    if (response.status === 204) return undefined as T;
    let result: any;
    try { result = JSON.parse(content); }
    catch { throw new Error(`服务器接口返回了非 JSON 内容（HTTP ${response.status}）。请检查 Pi Web 版本。`); }
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Pi Web 请求失败（HTTP ${response.status}）。`);
    return result as T;
  }

  async request(operation: PiOperation, input: Record<string, unknown> = {}): Promise<unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请求参数无效。');
    switch (operation) {
      case 'machine.status': return this.http(`${prefix}/status`);
      case 'sessions.unread': return this.http(`${prefix}/sessions/unread`);
      case 'projects.list': return this.http(`${prefix}/projects`);
      case 'projects.add': return this.http(`${prefix}/projects`, 'POST', { path: text(input.path, '项目路径'), name: input.name, create: input.create === true });
      case 'projects.directories': return this.http(`${prefix}/project-directories?q=${encodeURIComponent(typeof input.query === 'string' ? input.query : '')}`);
      case 'workspaces.list': return this.http(`${prefix}/projects/${encoded(input.projectId, '项目 ID')}/workspaces`);
      case 'workspace.trust': return this.http(`${workspacePath(input)}/trust`, 'PUT', { trusted: input.trusted === true });
      case 'sessions.list': return this.http(`${prefix}/sessions?cwd=${encoded(input.cwd, '工作目录')}`);
      case 'session.create': return this.http(`${prefix}/sessions`, 'POST', { cwd: text(input.cwd, '工作目录') });
      case 'files.tree': return this.http(`${workspacePath(input)}/tree?path=${encodeURIComponent(typeof input.path === 'string' ? input.path : '')}`);
      case 'files.read': return this.http(`${workspacePath(input)}/file?path=${encoded(input.path, '文件路径')}`);
      case 'files.suggest': {
        const query = typeof input.query === 'string' ? input.query : '';
        if (query.length > 4096 || query.includes('\0') || (input.scope !== 'tracked' && input.scope !== 'all')) throw new Error('文件搜索参数无效。');
        const endpoint = `${workspacePath(input)}/files`;
        const params = new URLSearchParams({ q: query, scope: input.scope, mode: 'path' });
        const normalize = (path: string) => {
          const normalized = posix.normalize(path.replace(/\\/g, '/')).toLowerCase();
          return normalized === '.' || normalized === './' ? '' : normalized;
        };
        const prefix = normalize(query);
        const paths = (await this.http<FileSuggestion[]>(`${endpoint}?${params}`)).filter((file) => normalize(file.path).startsWith(prefix));
        const exact = (path: string) => normalize(path).replace(/\/$/, '') === prefix.replace(/\/$/, '');
        paths.sort((a, b) => Number(exact(b.path)) - Number(exact(a.path)) || Number(b.path.endsWith('/')) - Number(a.path.endsWith('/')));
        // Explicit paths must never drift into similarly named cached copies.
        if (paths.length || !query || /[/\\]/.test(query) || query.startsWith('~')) return paths;
        params.set('mode', 'file');
        return this.http(`${endpoint}?${params}`);
      }
      case 'git.status': return this.pluginRequest('git', input, 'status', null);
      case 'git.diff': return this.pluginRequest('git', input, 'diff', { ...(input.path ? { path: text(input.path, '文件路径') } : {}), staged: input.staged === true });
    }
    const ref = refFrom(input);
    const get = (endpoint: string, extra?: Record<string, string>) => this.http(withCwd(sessionPath(ref, endpoint), ref.cwd, extra));
    const post = (endpoint: string, fields: Record<string, unknown> = {}, timeoutMs = 30_000) => this.http(sessionPath(ref, endpoint), 'POST', { cwd: ref.cwd, ...fields }, undefined, timeoutMs);
    switch (operation) {
      case 'session.acknowledgeUnread': {
        if (!Number.isSafeInteger(input.throughCompletionOrder) || Number(input.throughCompletionOrder) <= 0) throw new Error('未读完成序号无效。');
        return post('unread/acknowledge', { catalogId: text(input.catalogId, '未读目录 ID', 512), throughCompletionOrder: input.throughCompletionOrder });
      }
      case 'session.messages': return get('messages', { limit: '100', ...(Number.isSafeInteger(input.before) ? { before: String(input.before) } : {}), media: 'reference' });
      case 'session.prompt': {
        const prompt = typeof input.text === 'string' ? input.text : '';
        if (prompt.length > 1_000_000 || (!prompt.trim() && !Array.isArray(input.attachments))) throw new Error('请输入消息。');
        return post('prompt', { text: prompt, ...(input.streamingBehavior === 'followUp' || input.streamingBehavior === 'steer' ? { streamingBehavior: input.streamingBehavior } : {}), ...(Array.isArray(input.attachments) ? { attachments: input.attachments } : {}) });
      }
      case 'session.abort': return post('abort');
      case 'session.archive': return post('archive');
      case 'session.restore': return post('restore');
      case 'session.rename': return post('commands/run', { text: `/name ${text(input.name, '会话名称', 160).replace(/[\r\n]/g, ' ')}` });
      case 'session.commands': return get('commands');
      case 'session.command': return post('commands/run', { text: text(input.text, '命令', 1_000_000) }, 300_000);
      case 'session.command.respond': return post('commands/respond', { requestId: text(input.requestId, '命令请求 ID', 512), value: text(input.value, '命令选项', 4096) }, 300_000);
      case 'session.shell': return post('shell', { text: text(input.text, 'Shell 命令', 1_000_000) });
      case 'session.tree.navigate':
      case 'session.tree.fork': {
        if (input.expectedLeafId !== null && typeof input.expectedLeafId !== 'string') throw new Error('会话树位置无效。');
        const expectedLeafId = input.expectedLeafId === null ? null : text(input.expectedLeafId, '会话树位置', 512);
        if (operation === 'session.tree.fork') return post('tree/fork', { entryId: text(input.entryId, '消息 ID', 512), expectedLeafId }, 300_000);
        if (!['none', 'default', 'custom'].includes(String(input.summaryMode))) throw new Error('会话树摘要方式无效。');
        const summary = input.summaryMode === 'custom' ? { mode: 'custom', instructions: text(input.instructions, '摘要要求', 10_000) } : { mode: input.summaryMode };
        return post('tree/navigate', { targetId: text(input.targetId, '消息 ID', 512), expectedLeafId, summary }, 300_000);
      }
      case 'session.models': return get('models');
      case 'session.model': return post('model', { provider: text(input.provider, '模型供应商'), modelId: text(input.modelId, '模型 ID') });
      case 'session.thinkingLevels': return get('thinking-levels');
      case 'session.thinking': return post('thinking-level', { level: text(input.level, '思考强度', 32) });
      case 'session.dialog': return input.cancel === true ? post('dialogs/cancel', { dialogId: text(input.dialogId, '对话框 ID') }) : post('dialogs/answer', { dialogId: text(input.dialogId, '对话框 ID'), value: input.value });
      case 'session.ask': return input.cancel === true ? post('ask/cancel', { askId: text(input.askId, '问题 ID') }) : post('ask/submit', { askId: text(input.askId, '问题 ID'), answers: input.answers });
      case 'session.media': {
        const mediaId = text(input.mediaId, '图片 ID', 64);
        if (!/^[a-f0-9]{64}$/.test(mediaId) || !this.baseURL) throw new Error('图片 ID 无效。');
        const response = await fetch(`${this.baseURL}${withCwd(sessionPath(ref, `media/${mediaId}`), ref.cwd)}`, { redirect: 'error', signal: this.lifetime.signal });
        const mime = response.headers.get('content-type')?.split(';')[0];
        if (!response.ok || !mime || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) {
          await response.body?.cancel().catch(() => {});
          throw new Error('无法加载会话图片。');
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        const reader = response.body?.getReader();
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              length += value.byteLength;
              if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('图片过大。'); }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
        }
        const data = Buffer.concat(chunks, length);
        return `data:${mime};base64,${data.toString('base64')}`;
      }
      default: throw new Error('不支持的 Pi Web 操作。');
    }
  }

  async watchSession(session: SessionRef, subscriptionId: string): Promise<void> {
    const ref = refFrom(session as unknown as Record<string, unknown>);
    text(subscriptionId, '订阅 ID', 80);
    this.unwatch();
    const watch = { id: subscriptionId, session: ref, controller: new AbortController() } as NonNullable<PiClient['watch']>;
    this.watch = watch;
    this.startStream(watch, false);
  }
  unwatch(subscriptionId?: string): void {
    if (!this.watch || (subscriptionId && this.watch.id !== subscriptionId)) return;
    const watch = this.watch; this.watch = undefined;
    watch.controller.abort(); clearTimeout(watch.timer); watch.socket?.close();
  }
  private packet(packet: WorkspacePacket): void { this.emit('workspace', packet); }
  private startStream(watch: NonNullable<PiClient['watch']>, reconnecting: boolean): void {
    if (!this.baseURL || this.watch !== watch) return;
    this.packet({ type: 'stream', subscriptionId: watch.id, session: watch.session, state: reconnecting ? 'reconnecting' : 'connecting' });
    const path = withCwd(sessionPath(watch.session, 'events'), watch.session.cwd, { media: 'reference' });
    const socket = new WebSocket(`${this.baseURL.replace('http:', 'ws:')}${path}`);
    socket.binaryType = 'arraybuffer';
    watch.socket = socket;
    let ready = false;
    let watermark = -1;
    let buffered: SessionEvent[] = [];
    const active = () => this.watch === watch && watch.socket === socket && !watch.controller.signal.aborted;
    const timeout = setTimeout(() => socket.close(), 15_000);
    socket.addEventListener('message', (event) => {
      if (!active()) return;
      let parsed: SessionEvent;
      try { parsed = parseSocketFrame(event.data); } catch { return; }
      if (!ready) { buffered.push(parsed); return; }
      if (parsed.seq !== undefined && parsed.seq <= watermark) return;
      if (parsed.seq !== undefined) watermark = parsed.seq;
      this.packet({ type: 'event', subscriptionId: watch.id, session: watch.session, event: parsed });
    });
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      void this.http<TranscriptSnapshot>(withCwd(sessionPath(watch.session, 'transcript-snapshot'), watch.session.cwd, { limit: '100', media: 'reference' }), 'GET', undefined, watch.controller.signal).then((snapshot) => {
        if (!active()) return;
        if (!snapshot.page || !Array.isArray(snapshot.page.messages) || !snapshot.status) throw new Error('Pi Web 未提供会话快照，请更新远端服务。');
        watermark = snapshot.seq;
        this.packet({ type: 'snapshot', subscriptionId: watch.id, session: watch.session, snapshot });
        ready = true;
        for (const event of buffered) if (event.seq === undefined || event.seq > watermark) {
          if (event.seq !== undefined) watermark = event.seq;
          this.packet({ type: 'event', subscriptionId: watch.id, session: watch.session, event });
        }
        buffered = [];
        this.packet({ type: 'stream', subscriptionId: watch.id, session: watch.session, state: 'live' });
      }).catch((error) => {
        if (!active()) return;
        this.packet({ type: 'stream', subscriptionId: watch.id, session: watch.session, state: 'error', message: (error as Error).message });
        // A missing/incompatible endpoint needs an explicit retry, not an endless loop.
        watch.socket = undefined; socket.close();
      });
    });
    socket.addEventListener('error', () => { if (socket.readyState < 2) socket.close(); });
    socket.addEventListener('close', () => {
      clearTimeout(timeout);
      if (!active()) return;
      this.packet({ type: 'stream', subscriptionId: watch.id, session: watch.session, state: 'reconnecting' });
      watch.timer = setTimeout(() => this.startStream(watch, true), 1500);
    });
  }

  private async plugin(name: string): Promise<{ id: string; backendRevision: string; pairedChannelVersion?: number }> {
    if (!this.plugins) this.plugins = (await this.http<{ plugins: NonNullable<PiClient['plugins']> }>('/pi-web-plugins/manifest.json')).plugins;
    const plugin = this.plugins.find((item) => item.id === name || item.id === `pi-web.${name}`);
    if (!plugin?.backendRevision || plugin.pairedRequestVersion !== 1) throw new Error(`远端 ${name} 插件不可用，请在 Pi Web 中启用插件并检查版本。`);
    return { ...plugin, backendRevision: plugin.backendRevision };
  }
  private pluginPath(pluginId: string, input: Record<string, unknown>, operation: string, channel = false): string {
    return `/api/paired-plugin-backends/${encodeURIComponent(pluginId)}/projects/${encoded(input.projectId, '项目 ID')}/workspaces/${encoded(input.workspaceId, '工作区 ID')}/${channel ? 'channels/' : ''}${operation}`;
  }
  private async pluginRequest(name: string, scope: Record<string, unknown>, operation: string, input: unknown): Promise<unknown> {
    const plugin = await this.plugin(name);
    return this.http(this.pluginPath(plugin.id, scope, operation), 'POST', { revision: plugin.backendRevision, input });
  }
  async attachTerminal(projectId: string, workspaceId: string, subscriptionId: string, cols: number, rows: number): Promise<void> {
    this.detachTerminal();
    const terminal = { id: text(subscriptionId, '终端订阅 ID', 80), controller: new AbortController() } as NonNullable<PiClient['terminal']>;
    this.terminal = terminal;
    const input = { projectId, workspaceId };
    const plugin = await this.plugin('terminal');
    if (plugin.pairedChannelVersion !== 1) throw new Error('远端 Terminal 插件不支持终端通道，请更新 Pi Web。');
    const terminals = await this.pluginRequest('terminal', input, 'terminal.list', null) as { id: string; exited: boolean; commandRunId?: string }[];
    let selected = terminals.find((item) => !item.exited && !item.commandRunId);
    if (this.terminal !== terminal) return;
    if (!selected) selected = await this.pluginRequest('terminal', input, 'terminal.create', { cols, rows }) as typeof selected;
    if (this.terminal !== terminal || !selected || !this.baseURL) return;
    const socket = new WebSocket(`${this.baseURL.replace('http:', 'ws:')}${this.pluginPath(plugin.id, input, 'terminal.attach', true)}`);
    socket.binaryType = 'arraybuffer';
    terminal.socket = socket;
    const emit = (packet: Omit<TerminalPacket, 'subscriptionId'>) => { if (this.terminal === terminal) this.emit('terminal', { ...packet, subscriptionId }); };
    socket.addEventListener('open', () => socket.send(JSON.stringify({ version: 1, kind: 'open', revision: plugin.backendRevision, input: { terminalId: selected!.id, cols, rows } })));
    socket.addEventListener('message', (event) => {
      try {
        const frame = parseSocketFrame(event.data);
        if (frame.kind === 'ready') emit({ type: 'ready' });
        else if (frame.kind === 'error') emit({ type: 'error', message: frame.message });
        else if (frame.kind === 'data') emit(frame.data);
      } catch { emit({ type: 'error', message: '终端数据格式无效。' }); }
    });
    socket.addEventListener('close', () => emit({ type: 'error', message: '终端连接已关闭，重新打开面板可以恢复。' }));
    socket.addEventListener('error', () => emit({ type: 'error', message: '终端连接失败。' }));
  }
  terminalFrame(subscriptionId: string, input: unknown): void {
    if (this.terminal?.id !== subscriptionId || this.terminal.socket?.readyState !== WebSocket.OPEN) return;
    this.terminal.socket.send(JSON.stringify({ version: 1, kind: 'data', data: input }));
  }
  detachTerminal(subscriptionId?: string): void {
    if (!this.terminal || (subscriptionId && subscriptionId !== this.terminal.id)) return;
    const terminal = this.terminal; this.terminal = undefined;
    terminal.controller.abort(); terminal.socket?.close();
  }
}
