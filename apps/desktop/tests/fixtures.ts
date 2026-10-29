import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer as createHTTPServer } from 'node:http';
import { connect as connectTCP, type Socket } from 'node:net';
import ssh2, { type Connection } from 'ssh2';
import { WebSocketServer, WebSocket } from 'ws';
import type { CatalogEvent, MachineStatusSnapshot, Project, SessionInfo, SessionEvent, SessionStatus, SlashCommand, UnreadCatalog, WireMessage } from '../src/shared/pi';

export const TEST_PASSWORD = 'local-test-only-password';
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
export const fixtureHTML = '<!doctype html><html><title>Pi Web test fixture</title><pi-web-app>Original Pi Web fixture</pi-web-app></html>';
const prefix = '/api/machines/local';
export async function startFixture({ binaryFrames = false } = {}) {
  const encodeFrame = (value: unknown) => binaryFrames ? Buffer.from(JSON.stringify(value)) : JSON.stringify(value);
  const sockets = new Set<Socket>(); const clients = new Set<Connection>();
  const channels = new Map<WebSocket, string>(); const wss = new WebSocketServer({ noServer: true });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); };
  const now = new Date().toISOString(); let requests = 0;
  const projects: Project[] = [{ id: 'project-1', name: 'Remote Pi', path: '/srv/projects/remote-pi', createdAt: now }, { id: 'project-2', name: 'Website', path: '/srv/projects/website', createdAt: now }];
  const sessions: SessionInfo[] = [
    { id: 'session-1', cwd: projects[0]!.path, name: '重做远端工作台', firstMessage: '将项目与对话界面重新设计', created: now, modified: now, messageCount: 4 },
    { id: 'session-2', cwd: projects[0]!.path, name: '梳理 SSH 连接流程', firstMessage: '检查服务器连接', created: now, modified: now, messageCount: 2 },
    { id: 'session-3', cwd: projects[1]!.path, name: '首页布局探索', firstMessage: '设计首页', created: now, modified: now, messageCount: 0 },
  ];
  for (const session of sessions) session.path = `/sessions/${session.id}.jsonl`;
  const histories = new Map<string, WireMessage[]>([
    ['session-1', [
      { entryId: 'u1', role: 'user', content: [{ type: 'text', text: '把项目和对话界面重新做一下。希望像 Codex App 一样，专注聊天，同时可以随时查看代码和运行状态。' }] },
      { entryId: 'a1', role: 'assistant', model: 'test-model', content: [{ type: 'text', text: '我会把工作台分成三个区域，让常用操作更容易找到。\n\n- **项目侧栏**：按目录组织对话，随时继续之前的工作。\n- **聊天区域**：保留完整上下文，工具执行过程按需展开。\n- **工作区面板**：文件、变更和终端随用随开。' }, { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'src/renderer/main.tsx' } }] },
      { entryId: 't1', role: 'toolResult', toolCallId: 'tool-1', toolName: 'read', content: [{ type: 'text', text: 'export function App() {\n  return <Workspace />;\n}\n\nRead 142 lines.' }], isError: false },
      { entryId: 'a2', role: 'assistant', model: 'test-model', content: [{ type: 'text', text: '现有 SSH 连接能力可以继续复用。接下来会让新界面直接读取 Pi Web 的会话数据，并保持每个对话独立的草稿。\n\n你可以先查看右侧的文件与变更，再继续告诉我你想调整的细节。' }] },
    ]],
    ['session-2', [{ entryId: 's2u', role: 'user', content: '检查服务器连接' }, { entryId: 's2a', role: 'assistant', content: 'SSH 流程包括主机指纹确认、身份认证和本地端口转发。' }]],
  ]);
  const models = [{ provider: 'fixture', id: 'test-model', name: 'Test model' }, { provider: 'fixture', id: 'second-model', name: 'Second model' }];
  const statuses = new Map<string, SessionStatus>(); const sequences = new Map<string, number>();
  const snapshotDelay = new Map<string, number>();
  const completionDelay = new Map<string, number>();
  const fileReadDelay = new Map<string, number>(); const fileReadErrors = new Set<string>();
  let terminalReadyDelay = 0;
  const promptResponseDelay = new Map<string, number>();
  const commandResults = new Map<string, import('../src/shared/pi').CommandResult>();
  const commands: SlashCommand[] = [
    { name: 'session', source: 'builtin', description: 'Session stats' }, { name: 'fork', source: 'builtin' }, { name: 'clone', source: 'builtin' }, { name: 'tree', source: 'builtin' }, { name: 'reload', source: 'builtin' },
    { name: 'model', source: 'builtin' }, { name: 'new', source: 'builtin' }, { name: 'resume', source: 'builtin' },
    { name: 'skill:review', source: 'skill', description: 'Review code with a remote skill' },
    { name: 'review-pr', source: 'prompt', description: 'Review template', argumentHint: '<PR URL>' },
    { name: 'extension-check', source: 'extension', description: 'Interactive extension' },
  ];
  const calls: { method: string; path: string; body: any; query: Record<string, string> }[] = [];
  let environmentRuns = 0; let failEnvironmentRefresh = false;
  const status = (id: string) => { if (!statuses.has(id)) statuses.set(id, { sessionId: id, model: models[0], thinkingLevel: 'medium', isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], contextUsage: { tokens: 4200, contextWindow: 200000, percent: 2.1 }, cost: .028 }); return statuses.get(id)!; };
  let catalogPaused = false;
  const broadcast = (channel: string, event: SessionEvent | CatalogEvent) => { if (channel === 'catalog' && catalogPaused) return; for (const [socket, target] of channels) if (target === channel && socket.readyState === WebSocket.OPEN) socket.send(encodeFrame(event)); };
  const emit = (id: string, event: SessionEvent) => { const seq = (sequences.get(id) || 0) + 1; sequences.set(id, seq); broadcast(id, { ...event, seq }); };
  let machineRevision = 0;
  let unread: UnreadCatalog = { catalogId: 'fixture-unread', catalogRevision: 0, sessions: [] };
  const ackDelay = new Map<string, number>(); const catalogDelay = new Map<string, number>();
  const machineSnapshot = (): MachineStatusSnapshot => ({ epochId: 'fixture-machine', revision: machineRevision, sessions: Object.fromEntries(sessions.map((session) => [session.id, { 'core:working': Boolean(status(session.id).isStreaming || status(session.id).isCompacting || status(session.id).isBashRunning || status(session.id).pendingMessageCount), 'core:unread': unread.sessions.some((item) => item.sessionId === session.id && item.cwd === session.cwd) }])) });
  const publishMachine = () => { machineRevision++; broadcast('catalog', { type: 'machine.status', status: machineSnapshot() }); };
  const startWork = (id: string) => { status(id).isStreaming = true; emit(id, { type: 'status.update', status: status(id) }); broadcast('catalog', { type: 'status.update', status: status(id) }); publishMachine(); };
  const finishWork = (id: string) => {
    const session = sessions.find((item) => item.id === id)!; status(id).isStreaming = false;
    emit(id, { type: 'status.update', status: status(id) }); emit(id, { type: 'agent.end' }); broadcast('catalog', { type: 'status.update', status: status(id) });
    const revision = unread.catalogRevision + 1;
    const summary = { sessionId: id, cwd: session.cwd, completionOrder: revision, completedAt: new Date().toISOString() };
    unread = { ...unread, catalogRevision: revision, sessions: [summary, ...unread.sessions.filter((item) => item.sessionId !== id || item.cwd !== session.cwd)] };
    broadcast('catalog', { type: 'sessions.unread', catalogId: unread.catalogId, catalogRevision: revision, sessionId: id, cwd: session.cwd, unread: summary }); publishMachine();
  };
  const json = (response: import('node:http').ServerResponse, data: unknown, code = 200) => { response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); };
  const web = createHTTPServer(async (request, response) => {
    requests++;
    const url = new URL(request.url || '/', 'http://localhost'); const path = decodeURIComponent(url.pathname);
    let body: any = {}; let source = ''; for await (const chunk of request) source += chunk; if (source) { try { body = JSON.parse(source); } catch { json(response, { error: 'Invalid JSON' }, 400); return; } }
    calls.push({ method: request.method!, path, body, query: Object.fromEntries(url.searchParams) });
    if (path === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(fixtureHTML); return; }
    if (path === `${prefix}/status`) { const snapshot = structuredClone(machineSnapshot()); later(() => json(response, snapshot), catalogDelay.get('status') || 0); return; }
    if (path === `${prefix}/sessions/unread`) { const snapshot = structuredClone(unread); later(() => json(response, snapshot), catalogDelay.get('unread') || 0); return; }
    if (path === '/pi-web-plugins/manifest.json') { json(response, { plugins: ['git', 'terminal'].map((id) => ({ id, backendRevision: 'fixture-revision', pairedRequestVersion: 1, pairedChannelVersion: 1 })) }); return; }
    if (path.startsWith('/api/paired-plugin-backends/')) {
      if (body.revision !== 'fixture-revision') { json(response, { error: 'Wrong plugin revision' }, 409); return; }
      const operation = path.split('/').at(-1);
      if (operation === 'status') json(response, { isGitRepo: true, branch: 'main', files: [{ path: 'src/App.tsx', index: ' ', workingTree: 'M' }] });
      else if (operation === 'diff') json(response, { diff: 'diff --git a/src/App.tsx b/src/App.tsx\n--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -1 +1 @@\n-<OldWorkspace />\n+<Workspace />\n' });
      else if (operation === 'terminal.list') json(response, []);
      else if (operation === 'terminal.create') json(response, { id: 'terminal-1', cwd: projects[0]!.path, exited: false });
      else json(response, { error: 'Unknown plugin operation' }, 404);
      return;
    }
    if (path === `${prefix}/projects`) {
      if (request.method === 'POST') { const project = { id: randomUUID(), path: body.path, name: body.name || body.path.split('/').at(-1), createdAt: now }; projects.push(project); json(response, project); }
      else json(response, projects); return;
    }
    if (path === `${prefix}/project-directories`) { json(response, [{ path: '/srv/projects', kind: 'directory' }]); return; }
    const scope = path.match(/\/projects\/([^/]+)\/workspaces(?:\/([^/]+)\/(.*))?$/);
    if (scope) {
      const project = projects.find((item) => item.id === scope[1]);
      if (!project) { json(response, { error: 'No project' }, 404); return; }
      if (!scope[2]) json(response, { status: 'ready', workspaces: [{ id: `workspace-${project.id}`, projectId: project.id, path: project.path, label: 'main', isMain: true }] });
      else if (scope[3] === 'trust') json(response, { trusted: body.trusted });
      else if (scope[3] === 'tree') json(response, { path: '', entries: [{ name: 'src', path: 'src', type: 'directory' }, { name: 'README.md', path: 'README.md', type: 'file' }], truncated: false });
      else if (scope[3] === 'files') {
        const query = url.searchParams.get('q') || '';
        const entries = [
          { path: '.cache/clone-check/repos/jbsdiff/', kind: 'other' }, { path: '.cache/clone-check/repos/jbsdiff/pom.xml', kind: 'other' },
          { path: 'README.md', kind: 'tracked' }, { path: 'src/', kind: 'tracked' }, { path: 'docs/', kind: 'other' }, { path: 'docs/my file.md', kind: 'tracked' },
          { path: 'repos/', kind: 'other' }, { path: 'repos/jbsdiff-backup/', kind: 'other' }, { path: 'repos/jbsdiff/', kind: 'other' }, { path: 'repos/jbsdiff/src/', kind: 'other' }, { path: 'repos/jbsdiff/pom.xml', kind: 'other' },
          { path: 'local notes.txt', kind: 'untracked' },
        ];
        const pathQuery = query.replace(/^\.\//, '');
        const directory = pathQuery.slice(0, pathQuery.lastIndexOf('/') + 1);
        const files = url.searchParams.get('mode') === 'path'
          ? entries.filter((file) => file.path !== directory && file.path.startsWith(directory) && !file.path.slice(directory.length).replace(/\/$/, '').includes('/') && file.path.toLowerCase().includes(pathQuery.toLowerCase()))
          : entries.filter((file) => (file.kind !== 'untracked' || url.searchParams.get('scope') === 'all') && file.path.toLowerCase().includes(query.toLowerCase()));
        later(() => json(response, files), completionDelay.get(query) || 0);
      }
      else if (scope[3] === 'file') {
        const filePath = url.searchParams.get('path') || ''; const fail = fileReadErrors.has(filePath);
        later(() => fail ? json(response, { error: 'Delayed file read failed' }, 500) : json(response, { path: filePath, content: '# Remote Pi\n\nA native desktop workspace.\n', binary: false, truncated: false }), fileReadDelay.get(filePath) || 0);
      }
      else json(response, { error: 'No route' }, 404); return;
    }
    if (path === `${prefix}/sessions`) {
      if (request.method === 'POST') { const session = { id: randomUUID(), cwd: body.cwd, firstMessage: '', created: now, modified: new Date().toISOString(), messageCount: 0 }; sessions.push(session); json(response, session); }
      else json(response, sessions.filter((item) => item.cwd === url.searchParams.get('cwd'))); return;
    }
    const route = path.match(/\/sessions\/([^/]+)\/(.+)$/);
    if (route) {
      const [, id, endpoint] = route as [string, string, string]; const session = sessions.find((item) => item.id === id);
      if (!session) { json(response, { error: 'No session' }, 404); return; }
      if ((request.method === 'GET' ? url.searchParams.get('cwd') : body.cwd) !== session.cwd) { json(response, { error: 'Wrong cwd' }, 400); return; }
      if (endpoint === 'unread/acknowledge') {
        const summary = unread.sessions.find((item) => item.sessionId === id && item.cwd === body.cwd);
        if (body.catalogId === unread.catalogId && summary && summary.completionOrder <= body.throughCompletionOrder) {
          unread = { ...unread, catalogRevision: unread.catalogRevision + 1, sessions: unread.sessions.filter((item) => item !== summary) };
          broadcast('catalog', { type: 'sessions.unread', catalogId: unread.catalogId, catalogRevision: unread.catalogRevision, sessionId: id, cwd: body.cwd, unread: null }); publishMachine();
        }
        const snapshot = structuredClone(unread); later(() => json(response, snapshot), ackDelay.get(id) || 0);
      }
      else if (endpoint === 'models') json(response, { models });
      else if (endpoint === 'thinking-levels') json(response, { levels: ['off', 'low', 'medium', 'high'] });
      else if (endpoint === 'model') { Object.assign(status(id), { model: models.find((model) => model.id === body.modelId) }); json(response, status(id)); }
      else if (endpoint === 'thinking-level') { status(id).thinkingLevel = body.level; json(response, status(id)); }
      else if (endpoint === 'transcript-snapshot') {
        const snapshot = { page: { messages: histories.get(id) || [], start: 0, total: histories.get(id)?.length || 0 }, seq: sequences.get(id) || 0, partial: null, status: { ...status(id) } };
        later(() => json(response, snapshot), snapshotDelay.get(id) || 0);
      }
      else if (endpoint === 'messages') json(response, { messages: histories.get(id) || [], start: 0, total: histories.get(id)?.length || 0 });
      else if (endpoint === 'commands') { const result = structuredClone(commands); later(() => json(response, result), completionDelay.get(id) || 0); }
      else if (endpoint === 'commands/run') {
        if (commandResults.has(body.text)) { json(response, commandResults.get(body.text)); return; }
        if (body.text.startsWith('/name ')) { session.name = body.text.slice('/name '.length); broadcast('catalog', { type: 'session.name', sessionId: id, name: session.name }); json(response, { type: 'done' }); }
        else if (body.text === '/session') json(response, { type: 'done', message: 'Fixture session statistics' });
        else if (body.text === '/fork') json(response, { type: 'select', requestId: 'fork-request', title: 'Choose a message to fork', options: [{ value: 'u1', label: 'First user message' }] });
        else if (body.text === '/tree') json(response, { type: 'tree', tree: { activeLeafId: 'a1', activePathIds: ['u1', 'a1'], nodes: [{ id: 'u1', parentId: null, kind: 'user', summary: 'Original request' }, { id: 'a1', parentId: 'u1', kind: 'assistant', summary: 'Original response' }] } });
        else if (body.text === '/clone') { const next = { ...session, id: randomUUID(), name: 'Cloned conversation' }; sessions.push(next); histories.set(next.id, [...(histories.get(id) || [])]); json(response, { type: 'done', session: next }); }
        else if (body.text === '/reload') json(response, { type: 'done', message: 'Resources reloaded' });
        else if (body.text.startsWith('/skill:review') || body.text.startsWith('/review-pr')) {
          const message = { role: 'user', content: body.text.startsWith('/skill:') ? 'Expanded remote review skill' : 'Expanded review template' };
          histories.set(id, [...(histories.get(id) || []), message]); emit(id, { type: 'message.append', message }); json(response, { type: 'done' });
        } else if (body.text === '/extension-check') {
          const dialog = { dialogId: 'extension-input', kind: 'input' as const, title: 'Extension input', placeholder: 'Type a value' };
          status(id).pendingDialogs = [dialog]; emit(id, { type: 'dialog.opened', dialog }); json(response, { type: 'done' });
        } else json(response, { type: 'unsupported', message: 'This command is unavailable' });
      }
      else if (endpoint === 'commands/respond' || endpoint === 'tree/fork') {
        const next = { ...session, id: randomUUID(), name: 'Forked conversation' }; sessions.push(next); histories.set(next.id, []);
        json(response, endpoint === 'commands/respond' ? { type: 'done', session: next, promptDraft: 'Restored fork draft' } : { cancelled: false, session: next, promptDraft: 'Tree fork draft' });
      }
      else if (endpoint === 'tree/navigate') json(response, body.expectedLeafId === 'a1' ? { cancelled: false, editorText: 'Restored tree draft' } : { error: 'Stale tree' }, body.expectedLeafId === 'a1' ? 200 : 409);
      else if (endpoint === 'shell') { emit(id, { type: 'shell.start', command: body.text }); emit(id, { type: 'shell.end', output: 'Fixture shell output', exitCode: 0 }); json(response, { accepted: true }); }
      else if (endpoint === 'archive' || endpoint === 'restore') { session.archived = endpoint === 'archive'; json(response, { archived: session.archived }); }
      else if (endpoint === 'abort') { finishWork(id); json(response, { ok: true }); }
      else if (endpoint === 'prompt') {
        const history = histories.get(id) || []; histories.set(id, history); const turn = randomUUID();
        const user = { role: 'user', entryId: `${turn}-u`, timestamp: Date.now(), content: body.text }; history.push(user); session.firstMessage ||= body.text; session.modified = new Date().toISOString();
        emit(id, { type: 'message.append', message: { role: 'user', content: body.text } });
        emit(id, { type: 'message.end', message: { role: 'user', timestamp: user.timestamp, content: [{ type: 'text', text: body.text }] } });
        emit(id, { type: 'message.append', message: user }); startWork(id);
        emit(id, { type: 'assistant.start', message: { role: 'assistant', streamId: turn, content: [] } });
        later(() => json(response, { ok: true }), promptResponseDelay.get(id) || 0);
        later(() => emit(id, { type: 'assistant.delta', streamId: turn, text: '已收到。' }), 80);
        later(() => emit(id, { type: 'assistant.delta', streamId: turn, text: '这是通过真实 SSH 隧道传输的测试流式回复。' }), 180);
        later(() => { const assistant = { role: 'assistant', entryId: `${turn}-a`, streamId: turn, content: '已收到。这是通过真实 SSH 隧道传输的测试流式回复。' }; history.push(assistant); emit(id, { type: 'message.end', message: assistant }); finishWork(id); }, 300);
      }
      else if (endpoint.startsWith('dialogs/') || endpoint.startsWith('ask/')) { status(id).pendingDialogs = []; emit(id, { type: 'dialog.closed', dialogId: body.dialogId }); json(response, { result: 'closed', sessionStatus: status(id) }); }
      else json(response, { error: `Unknown endpoint ${endpoint}` }, 404);
      return;
    }
    json(response, { error: `Unknown route ${path}` }, 404);
  });
  web.on('upgrade', (request, socket, head) => wss.handleUpgrade(request, socket, head, (ws) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    const sessionId = path.match(/\/sessions\/([^/]+)\/events/)?.[1]; channels.set(ws, path.includes('terminal.attach') ? 'terminal' : sessionId || 'catalog');
    if (!sessionId && !path.includes('terminal.attach')) ws.send(encodeFrame({ type: 'machine.status', status: machineSnapshot() }));
    ws.on('close', () => channels.delete(ws)); ws.on('error', () => {});
    if (path.includes('terminal.attach')) ws.on('message', (source) => { const frame = JSON.parse(String(source)); if (frame.kind === 'open') { later(() => { if (ws.readyState !== WebSocket.OPEN) return; ws.send(encodeFrame({ version: 1, kind: 'ready' })); ws.send(encodeFrame({ version: 1, kind: 'data', data: { type: 'output', data: 'remote@test:/srv/projects/remote-pi$ ' } })); }, terminalReadyDelay); } else if (frame.kind === 'data' && frame.data.type === 'input') ws.send(encodeFrame({ version: 1, kind: 'data', data: { type: 'output', data: frame.data.data } })); });
  }));
  web.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve)); const webPort = (web.address() as { port: number }).port;
  const ssh = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', (context) => { if (context.method === 'password' && context.password === TEST_PASSWORD) context.accept(); else context.reject(['password']); });
    client.on('ready', () => client.on('tcpip', (accept, reject, info) => { if (info.destIP !== '127.0.0.1' || info.destPort !== webPort) { reject(); return; } const socket = connectTCP(webPort, '127.0.0.1', () => { const channel = accept(); channel.pipe(socket).pipe(channel); }); socket.on('error', () => { try { reject(); } catch {} }); }));
    client.on('session', (accept) => {
      const session = accept();
      session.on('exec', (accept, reject, info) => {
        if (info.command !== `python3 - ${webPort}`) { reject?.(); return; }
        const channel = accept(); let script = '';
        channel.on('data', (chunk: Buffer) => { script += chunk.toString(); });
        channel.on('end', () => {
          environmentRuns++;
          if (!script.includes("PREFIX = 'REMOTE_PI_ENV '") || !script.includes('def refresh(port):')) { channel.exit(1); channel.end(); return; }
          const progress = (phase: string, message: string) => channel.write(`REMOTE_PI_ENV ${JSON.stringify({ phase, message })}\n`);
          progress('checking', '正在检查远端服务和运行中的任务…');
          if (Object.values(machineSnapshot().sessions).some((item) => item['core:working'])) {
            progress('error', '有对话或子任务正在执行，请等任务结束后再刷新远端环境。'); channel.exit(1); channel.end(); return;
          }
          progress('reading', '正在从新的登录终端读取代理配置…');
          later(() => progress('restarting', '正在重启 Pi Web 和 sessiond…'), 100);
          later(() => {
            if (failEnvironmentRefresh) { progress('rollback', '正在恢复之前的代理配置和服务…'); progress('error', '刷新失败，已恢复之前的代理配置和服务。'); channel.exit(1); }
            else { progress('done', '远端环境已刷新 · 已同步 6 项代理变量，服务健康检查通过。'); channel.exit(0); }
            channel.end();
          }, 500);
        });
      });
    });
  });
  await new Promise<void>((resolve) => ssh.listen(0, '127.0.0.1', resolve));
  return { sshPort: (ssh.address() as { port: number }).port, webPort, calls, sessions, snapshotDelay, completionDelay, fileReadDelay, fileReadErrors, promptResponseDelay, commandResults, commands, histories, emit, startWork, finishWork, ackDelay, catalogDelay,
    delayTerminalReady(ms: number) { terminalReadyDelay = ms; },
    get environmentRuns() { return environmentRuns; },
    failEnvironmentRefresh(fail: boolean) { failEnvironmentRefresh = fail; },
    get requests() { return requests; },
    closeStreams(id: string) { for (const [socket, target] of channels) if (target === id) socket.close(); },
    closeCatalog() { for (const [socket, target] of channels) if (target === 'catalog') socket.close(); },
    pauseCatalog(paused: boolean) { catalogPaused = paused; },
    get unread() { return unread; },
    disconnectClients() { for (const client of clients) client.end(); },
    async close() { for (const timer of timers) clearTimeout(timer); for (const socket of channels.keys()) socket.terminate(); for (const client of clients) client.end(); for (const socket of sockets) socket.destroy(); wss.close(); await Promise.all([new Promise<void>((resolve) => ssh.close(() => resolve())), new Promise<void>((resolve) => web.close(() => resolve()))]); },
  };
}
