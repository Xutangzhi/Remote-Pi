import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CommandResult, FileSuggestion, PiOperation, SlashCommand } from '../src/shared/pi';

type Request = { path: string; method: string; body?: unknown; image?: boolean; timeoutMs?: number };
const requests: Request[] = [];
let respond: (request: Request) => unknown | Promise<unknown> = () => ({});
Object.assign(globalThis, { Capacitor: {
  PluginHeaders: [{ name: 'RemotePi', methods: ['request', 'openSocket', 'closeSocket'].map((name) => ({ name, rtype: 'promise' })) }],
  nativePromise: async (_plugin: string, method: string, options: Request) => {
    if (method !== 'request') return;
    requests.push(options);
    return { data: JSON.stringify(await respond(options)) };
  },
} });
const { PiClient } = await import('../src/platform/pi-client');
const session = { id: 'session /一', cwd: '/srv/projects/with space&name' };
const scope = { projectId: 'project-1', workspaceId: 'workspace-1', scope: 'tracked' };
const url = (request: Request) => new URL(request.path, 'http://127.0.0.1');
const clientFor = (handler: typeof respond) => {
  requests.length = 0; respond = handler;
  const client = new PiClient(); client.connect('http://127.0.0.1'); return client;
};

test('native adapter preserves command choices, skill drafts and model/shell session scope', async () => {
  const commands: SlashCommand[] = [{ name: 'skill:review', source: 'skill', argumentHint: '<path>' }];
  const fork: CommandResult = { type: 'done', promptDraft: 'Restored fork draft', session: { ...session, id: 'forked', firstMessage: '', created: '', modified: '', messageCount: 0 } };
  const client = clientFor((request) => {
    if (url(request).pathname.endsWith('/commands')) return commands;
    if (url(request).pathname.endsWith('/commands/respond')) return fork;
    return { type: 'done' };
  });
  try {
    assert.deepEqual(await client.request('session.commands', session), commands);
    assert.equal(url(requests[0]!).searchParams.get('cwd'), session.cwd);
    assert.equal(url(requests[0]!).pathname, '/api/machines/local/sessions/session%20%2F%E4%B8%80/commands');
    const command = '/skill:review inspect @"docs/my file.md"';
    await client.request('session.command', { ...session, text: command });
    assert.deepEqual(requests.at(-1), { path: '/api/machines/local/sessions/session%20%2F%E4%B8%80/commands/run', method: 'POST', timeoutMs: 300_000, body: { cwd: session.cwd, text: command } });
    assert.deepEqual(await client.request('session.command.respond', { ...session, requestId: 'choice-1', value: 'entry-1' }), fork);
    assert.deepEqual(requests.at(-1)?.body, { cwd: session.cwd, requestId: 'choice-1', value: 'entry-1' });
    assert.equal(requests.at(-1)?.timeoutMs, 300_000);
    await client.request('session.models', session);
    assert.ok(url(requests.at(-1)!).pathname.endsWith('/models'));
    await client.request('session.model', { ...session, provider: 'fixture', modelId: 'test-model' });
    assert.deepEqual(requests.at(-1)?.body, { cwd: session.cwd, provider: 'fixture', modelId: 'test-model' });
    await client.request('session.shell', { ...session, text: '!pwd' });
    assert.ok(url(requests.at(-1)!).pathname.endsWith('/shell'));
    assert.deepEqual(requests.at(-1)?.body, { cwd: session.cwd, text: '!pwd' });
    assert.equal(requests.at(-1)?.timeoutMs, 30_000);
    assert.equal(requests.some((request) => url(request).pathname.endsWith('/prompt')), false);
  } finally { client.disconnect(); }
});

test('tree operations carry concurrency guards and reject invalid parameters before native requests', async () => {
  const client = clientFor(() => ({ type: 'done' }));
  try {
    await client.request('session.tree.fork', { ...session, entryId: 'u1', expectedLeafId: null });
    assert.deepEqual(requests.at(-1)?.body, { cwd: session.cwd, entryId: 'u1', expectedLeafId: null });
    assert.equal(requests.at(-1)?.timeoutMs, 300_000);
    await client.request('session.tree.navigate', { ...session, targetId: 'u1', expectedLeafId: 'a1', summaryMode: 'custom', instructions: 'Keep decisions' });
    assert.deepEqual(requests.at(-1)?.body, { cwd: session.cwd, targetId: 'u1', expectedLeafId: 'a1', summary: { mode: 'custom', instructions: 'Keep decisions' } });
    assert.equal(requests.at(-1)?.timeoutMs, 300_000);
    const invalid: [PiOperation, Record<string, unknown>][] = [
      ['session.command', { text: '' }],
      ['session.command', { text: '/skill:review\0' }],
      ['session.command.respond', { requestId: 'choice-1', value: '' }],
      ['session.tree.fork', { entryId: 'u1' }],
      ['session.tree.navigate', { targetId: 'u1', expectedLeafId: 'a1', summaryMode: 'unknown' }],
      ['session.tree.navigate', { targetId: 'u1', expectedLeafId: 'a1', summaryMode: 'custom', instructions: '' }],
    ];
    const count = requests.length;
    for (const [operation, input] of invalid) await assert.rejects(client.request(operation, { ...session, ...input }));
    await assert.rejects(client.request('files.suggest', { ...scope, query: 'bad\0path' }), /文件搜索参数/);
    await assert.rejects(client.request('files.suggest', { ...scope, query: 'x'.repeat(4097) }), /文件搜索参数/);
    await assert.rejects(client.request('files.suggest', { ...scope, scope: 'unsafe' }), /文件搜索参数/);
    assert.equal(requests.length, count);
  } finally { client.disconnect(); }
});

test('literal paths and directories beat cached fuzzy copies with portable POSIX normalization', async () => {
  const files: FileSuggestion[] = [
    { path: '.cache/clone-check/repos/jbsdiff/', kind: 'other' },
    { path: 'repos/jbsdiff/pom.xml', kind: 'tracked' },
    { path: 'repos/jbsdiff/src/', kind: 'tracked' },
    { path: 'repos/jbsdiff/', kind: 'tracked' },
  ];
  const client = clientFor(() => files);
  try {
    for (const query of ['repos/jbsdiff', './repos/jbsdiff', 'repos//jbsdiff', 'repos/old/../jbsdiff', 'repos\\jbsdiff', 'REPOS/JBSDIFF']) {
      const result = await client.request('files.suggest', { ...scope, query }) as FileSuggestion[];
      assert.deepEqual(result.map((file) => file.path), ['repos/jbsdiff/', 'repos/jbsdiff/src/', 'repos/jbsdiff/pom.xml']);
    }
    for (const query of ['./', './/', 'repos/../']) assert.equal((await client.request('files.suggest', { ...scope, query }) as FileSuggestion[]).length, files.length);
    for (const query of ['repos/missing/', '~missing', 'repos\\missing', '/missing']) assert.deepEqual(await client.request('files.suggest', { ...scope, query }), []);
    assert.ok(requests.every((request) => url(request).searchParams.get('mode') === 'path'));
    respond = () => [{ path: '/srv/repos/jbsdiff/', kind: 'other' }];
    assert.deepEqual(await client.request('files.suggest', { ...scope, query: '/srv/old/../repos/jbsdiff' }), [{ path: '/srv/repos/jbsdiff/', kind: 'other' }]);
  } finally { client.disconnect(); }
});

test('only an unmatched basename falls back to fuzzy file search and query characters stay encoded', async () => {
  const match: FileSuggestion[] = [{ path: 'docs/my file&more.md', kind: 'untracked' }];
  const client = clientFor((request) => url(request).searchParams.get('mode') === 'file' ? match : []);
  try {
    assert.deepEqual(await client.request('files.suggest', { ...scope, query: 'my file&more', scope: 'all' }), match);
    assert.deepEqual(requests.map((request) => Object.fromEntries(url(request).searchParams)), [
      { q: 'my file&more', scope: 'all', mode: 'path' },
      { q: 'my file&more', scope: 'all', mode: 'file' },
    ]);
    requests.length = 0;
    assert.deepEqual(await client.request('files.suggest', { ...scope, query: '' }), []);
    assert.equal(requests.length, 1);
  } finally { client.disconnect(); }
});

test('a long command response cannot cross a disconnected native connection', async () => {
  let finish!: (value: unknown) => void;
  const client = clientFor(() => new Promise((resolve) => { finish = resolve; }));
  try {
    const pending = client.request('session.command', { ...session, text: '/compact' });
    await new Promise((resolve) => setImmediate(resolve));
    client.disconnect();
    finish({ type: 'done', promptDraft: 'Old connection result' });
    await assert.rejects(pending, /请求已取消/);
  } finally { client.disconnect(); }
});
