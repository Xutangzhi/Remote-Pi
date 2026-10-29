import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PiClient } from '../src/main/pi-client';
import type { WorkspacePacket } from '../src/shared/pi';
import { startFixture } from './fixtures';
const until = async (condition: () => boolean, timeout = 6000) => { const deadline = Date.now() + timeout; while (!condition()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise((resolve) => setTimeout(resolve, 20)); } };

test('Pi adapter uses machine-scoped core routes and revision-paired plugin routes', async () => {
  const fixture = await startFixture(); const client = new PiClient(); client.connect(`http://127.0.0.1:${fixture.webPort}`);
  try {
    const projects = await client.request('projects.list') as { id: string }[]; assert.equal(projects.length, 2);
    await client.request('session.model', { id: 'session-1', cwd: '/srv/projects/remote-pi', provider: 'fixture', modelId: 'second-model' });
    const scope = { projectId: 'project-1', workspaceId: 'workspace-project-1' };
    const diff = await client.request('git.diff', { ...scope, staged: false }) as { diff: string }; assert.match(diff.diff, /Workspace/);
    assert.deepEqual(fixture.calls.find((call) => call.path.endsWith('/git/projects/project-1/workspaces/workspace-project-1/diff'))?.body, { revision: 'fixture-revision', input: { staged: false } });
    const previous = fixture.calls.length;
    await assert.rejects(client.request('arbitrary' as never, { id: 'session-1', cwd: '/', url: 'https://example.com' }), /不支持/);
    assert.equal(fixture.calls.length, previous);
    assert.throws(() => client.connect('https://example.com'), /本地 SSH/);
  } finally { client.disconnect(); await fixture.close(); }
});

test('switching sessions drops a slow previous snapshot, reconnect replaces history at a new watermark', async () => {
  const fixture = await startFixture(); const client = new PiClient(); const packets: WorkspacePacket[] = []; client.on('workspace', (packet) => packets.push(packet));
  client.connect(`http://127.0.0.1:${fixture.webPort}`);
  try {
    fixture.snapshotDelay.set('session-1', 300);
    await client.watchSession({ id: 'session-1', cwd: '/srv/projects/remote-pi' }, 'old');
    await until(() => fixture.calls.some((call) => call.path.endsWith('session-1/transcript-snapshot')));
    await client.watchSession({ id: 'session-2', cwd: '/srv/projects/remote-pi' }, 'new');
    await until(() => packets.some((packet) => packet.type === 'snapshot' && packet.subscriptionId === 'new'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(packets.filter((packet) => packet.type === 'snapshot' && packet.subscriptionId === 'old').length, 0);
    fixture.closeStreams('session-2');
    await until(() => packets.filter((packet) => packet.type === 'snapshot' && packet.subscriptionId === 'new').length === 2);
    assert.ok(packets.some((packet) => packet.type === 'stream' && packet.state === 'reconnecting'));
  } finally { client.disconnect(); await fixture.close(); }
});

test('events arriving during snapshot load are replayed once past the snapshot watermark', async () => {
  const fixture = await startFixture(); const client = new PiClient(); const packets: WorkspacePacket[] = []; client.on('workspace', (packet) => packets.push(packet));
  client.connect(`http://127.0.0.1:${fixture.webPort}`);
  try {
    fixture.snapshotDelay.set('session-1', 150);
    await client.watchSession({ id: 'session-1', cwd: '/srv/projects/remote-pi' }, 'live');
    await until(() => fixture.calls.some((call) => call.path.endsWith('session-1/transcript-snapshot')));
    fixture.emit('session-1', { type: 'assistant.delta', text: 'after snapshot', streamId: 's' });
    await until(() => packets.some((packet) => packet.type === 'stream' && packet.state === 'live'));
    assert.equal(packets.filter((packet) => packet.type === 'event' && packet.event.type === 'assistant.delta').length, 1);
    assert.ok(packets.findIndex((packet) => packet.type === 'snapshot') < packets.findIndex((packet) => packet.type === 'event'));
  } finally { client.disconnect(); await fixture.close(); }
});

test('activity catalogs and read receipts use server watermarks and preserve a newer completion', async () => {
  const fixture = await startFixture(); const client = new PiClient(); client.connect(`http://127.0.0.1:${fixture.webPort}`);
  try {
    fixture.startWork('session-2');
    const status = await client.request('machine.status') as import('../src/shared/pi').MachineStatusSnapshot;
    assert.equal(status.sessions['session-2']?.['core:working'], true);
    fixture.finishWork('session-2');
    const unread = await client.request('sessions.unread') as import('../src/shared/pi').UnreadCatalog;
    const first = unread.sessions[0]!;
    fixture.finishWork('session-2');
    const input = { id: 'session-2', cwd: first.cwd, catalogId: unread.catalogId, throughCompletionOrder: first.completionOrder };
    const stale = await client.request('session.acknowledgeUnread', input) as import('../src/shared/pi').UnreadCatalog;
    assert.equal(stale.sessions.length, 1);
    assert.ok(stale.sessions[0]!.completionOrder > first.completionOrder);
    const cleared = await client.request('session.acknowledgeUnread', { ...input, throughCompletionOrder: stale.sessions[0]!.completionOrder }) as import('../src/shared/pi').UnreadCatalog;
    assert.equal(cleared.sessions.length, 0);
    await assert.rejects(client.request('session.acknowledgeUnread', { ...input, throughCompletionOrder: -1 }), /序号无效/);
    assert.deepEqual(fixture.calls.find((call) => call.path.endsWith('/unread/acknowledge'))?.body, { cwd: first.cwd, catalogId: unread.catalogId, throughCompletionOrder: first.completionOrder });
  } finally { client.disconnect(); await fixture.close(); }
});

test('binary proxy frames update session messages, activity catalogs and terminal output without refresh', async () => {
  const fixture = await startFixture({ binaryFrames: true }); const client = new PiClient();
  const packets: WorkspacePacket[] = []; const terminal: import('../src/shared/pi').TerminalPacket[] = [];
  client.on('workspace', (packet) => packets.push(packet)); client.on('terminal', (packet) => terminal.push(packet));
  client.connect(`http://127.0.0.1:${fixture.webPort}`);
  try {
    await until(() => packets.some((packet) => packet.type === 'catalog' && packet.event.type === 'machine.status'));
    const session = { id: 'session-1', cwd: '/srv/projects/remote-pi' };
    await client.watchSession(session, 'binary');
    await until(() => packets.some((packet) => packet.type === 'stream' && packet.state === 'live'));
    await client.request('session.prompt', { ...session, text: '二进制帧实时回归' });
    await until(() => packets.some((packet) => packet.type === 'event' && packet.event.type === 'agent.end'));
    assert.ok(packets.some((packet) => packet.type === 'event' && packet.event.type === 'message.append' && typeof packet.event.message === 'object' && packet.event.message.content === '二进制帧实时回归'));
    assert.ok(packets.some((packet) => packet.type === 'event' && packet.event.type === 'assistant.delta' && packet.event.text?.includes('真实 SSH 隧道')));
    assert.ok(packets.some((packet) => packet.type === 'catalog' && packet.event.type === 'sessions.unread'));
    assert.equal(fixture.calls.filter((call) => call.path.endsWith('/transcript-snapshot')).length, 1);
    await client.attachTerminal('project-1', 'workspace-project-1', 'binary-terminal', 80, 24);
    await until(() => terminal.some((packet) => packet.type === 'ready'));
    client.terminalFrame('binary-terminal', { type: 'input', data: '终端实时回归\n' });
    await until(() => terminal.some((packet) => packet.type === 'output' && packet.data === '终端实时回归\n'));
    assert.equal(terminal.some((packet) => packet.type === 'error'), false);
  } finally { client.disconnect(); await fixture.close(); }
});

test('command, skill and file APIs preserve remote scope, responses and tree concurrency guards', async () => {
  const fixture = await startFixture(); const client = new PiClient(); client.connect(`http://127.0.0.1:${fixture.webPort}`);
  const session = { id: 'session-1', cwd: '/srv/projects/remote-pi' };
  try {
    const commands = await client.request('session.commands', session) as { name: string; source: string }[];
    assert.ok(commands.some((entry) => entry.name === 'skill:review' && entry.source === 'skill'));
    await client.request('session.command', { ...session, text: '/skill:review inspect @"docs/my file.md"' });
    assert.equal(fixture.calls.filter((call) => call.path.endsWith('/prompt')).length, 0);
    const selection = await client.request('session.command', { ...session, text: '/fork' }) as { requestId: string };
    const fork = await client.request('session.command.respond', { ...session, requestId: selection.requestId, value: 'u1' }) as { session: { id: string }; promptDraft: string };
    assert.notEqual(fork.session.id, session.id);
    assert.equal(fork.promptDraft, 'Restored fork draft');
    await client.request('files.suggest', { projectId: 'project-1', workspaceId: 'workspace-project-1', query: 'local notes&more', scope: 'all' });
    const request = fixture.calls.findLast((call) => call.path.endsWith('/files'))!;
    assert.deepEqual(request.query, { q: 'local notes&more', scope: 'all', mode: 'file' });
    await assert.rejects(client.request('files.suggest', { projectId: 'project-1', workspaceId: 'workspace-project-1', scope: 'unsafe' }), /搜索参数/);
    await assert.rejects(client.request('session.tree.navigate', { ...session, targetId: 'u1', expectedLeafId: 'stale', summaryMode: 'none' }), /Stale tree/);
    await client.request('session.tree.navigate', { ...session, targetId: 'u1', expectedLeafId: 'a1', summaryMode: 'custom', instructions: 'Keep decisions' });
    const navigation = fixture.calls.findLast((call) => call.path.endsWith('/tree/navigate'))!;
    assert.deepEqual(navigation.body, { cwd: session.cwd, targetId: 'u1', expectedLeafId: 'a1', summary: { mode: 'custom', instructions: 'Keep decisions' } });
  } finally { client.disconnect(); await fixture.close(); }
});


test('literal workspace paths beat cached fuzzy copies and directory traversal stays local to that path', async () => {
  const fixture = await startFixture(); const client = new PiClient(); client.connect(`http://127.0.0.1:${fixture.webPort}`);
  const scope = { projectId: 'project-1', workspaceId: 'workspace-project-1', scope: 'tracked' };
  try {
    const directory = await client.request('files.suggest', { ...scope, query: 'repos/jbsdiff' }) as { path: string }[];
    assert.equal(directory[0]?.path, 'repos/jbsdiff/');
    assert.ok(directory.every((file) => file.path.startsWith('repos/jbsdiff')));
    assert.ok(fixture.calls.filter((call) => call.path.endsWith('/files')).every((call) => call.query.mode === 'path'));
    const relative = await client.request('files.suggest', { ...scope, query: './repos/jbsdiff' }) as { path: string }[];
    assert.equal(relative[0]?.path, 'repos/jbsdiff/');
    const root = await client.request('files.suggest', { ...scope, query: './' }) as { path: string }[];
    assert.ok(root.some((file) => file.path === 'repos/'));
    const children = await client.request('files.suggest', { ...scope, query: 'repos/jbsdiff/' }) as { path: string }[];
    assert.deepEqual(children.map((file) => file.path), ['repos/jbsdiff/src/', 'repos/jbsdiff/pom.xml']);
    assert.deepEqual(await client.request('files.suggest', { ...scope, query: 'repos/missing/' }), []);
    const fuzzy = await client.request('files.suggest', { ...scope, query: 'my file' }) as { path: string }[];
    assert.equal(fuzzy[0]?.path, 'docs/my file.md');
    assert.equal(fixture.calls.findLast((call) => call.path.endsWith('/files'))?.query.mode, 'file');
  } finally { client.disconnect(); await fixture.close(); }
});


async function mediaFixture(total: number, contentType = 'image/png') {
  let sent = 0, closed = false;
  const server = createServer((request, response) => {
    if (!request.url?.includes('/media/')) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': contentType });
    const timer = setInterval(() => {
      const length = Math.min(256 * 1024, total - sent);
      response.write(Buffer.alloc(length, 42)); sent += length;
      if (sent === total) { clearInterval(timer); response.end(); }
    }, 2);
    response.on('close', () => { closed = true; clearInterval(timer); });
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new PiClient(); client.connect(`http://127.0.0.1:${address.port}`);
  return {
    client, get sent() { return sent; }, get closed() { return closed; },
    read: () => client.request('session.media', { id: 'media-test', cwd: '/test', mediaId: 'a'.repeat(64) }),
    async close() { client.disconnect(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}

test('session media cancels a chunked response as soon as it exceeds 20 MiB', async () => {
  const total = 64 * 1024 * 1024;
  const fixture = await mediaFixture(total);
  try {
    await assert.rejects(fixture.read(), /图片过大/);
    await until(() => fixture.closed);
    assert.ok(fixture.sent < total, 'the oversized response must be cancelled before the server sends the entire body');
  } finally { await fixture.close(); }
});

test('session media accepts a chunked response of exactly 20 MiB', async () => {
  const limit = 20 * 1024 * 1024;
  const fixture = await mediaFixture(limit);
  try {
    const result = await fixture.read() as string;
    assert.ok(result.startsWith('data:image/png;base64,'));
    const bytes = Buffer.from(result.slice('data:image/png;base64,'.length), 'base64');
    assert.equal(bytes.length, limit);
    assert.equal(bytes[0], 42); assert.equal(bytes.at(-1), 42);
  } finally { await fixture.close(); }
});

test('disconnect cancels session media while its response body is still streaming', async () => {
  const total = 64 * 1024 * 1024;
  const fixture = await mediaFixture(total);
  try {
    const rejected = assert.rejects(fixture.read(), (error: Error) => error.name === 'AbortError');
    await until(() => fixture.sent > 0);
    fixture.client.disconnect();
    await rejected;
    await until(() => fixture.closed);
    assert.ok(fixture.sent < total);
  } finally { await fixture.close(); }
});


test('session media cancels an invalid MIME response without consuming its body', async () => {
  const total = 64 * 1024 * 1024;
  const fixture = await mediaFixture(total, 'text/plain');
  try {
    await assert.rejects(fixture.read(), /无法加载会话图片/);
    await until(() => fixture.closed);
    assert.ok(fixture.sent <= 1024 * 1024, 'an invalid response must be cancelled after headers instead of waiting for garbage collection');
  } finally { await fixture.close(); }
});
