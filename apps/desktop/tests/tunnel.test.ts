import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { AuthBroker } from '../src/main/auth-broker';
import { TunnelManager } from '../src/main/tunnel';
import { startFixture, TEST_PASSWORD } from './fixtures';

test('askpass broker rejects unauthenticated requests and supports explicit cancellation', async () => {
  const broker = new AuthBroker((challenge) => { if (challenge) setTimeout(() => broker.answer(challenge.id, null), 10); });
  await broker.start();
  try {
    const endpoint = `http://127.0.0.1:${broker.port}/challenge`;
    assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 403);
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${broker.token}` }, body: JSON.stringify({ prompt: 'Password:' }) });
    assert.deepEqual(await response.json(), { answer: '' });
  } finally { await broker.close(); }
});

test('real OpenSSH: verifies a host, asks for password, forwards HTTP and detects disconnect', { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-ssh-'));
  const fixture = await startFixture();
  const challenges: string[] = [];
  const broker = new AuthBroker((challenge) => {
    if (!challenge) return;
    challenges.push(challenge.kind);
    setTimeout(() => broker.answer(challenge.id, challenge.kind === 'host' ? 'yes' : TEST_PASSWORD), 5);
  });
  await broker.start();
  const helper = join(dir, 'askpass');
  await writeFile(helper, `#!/bin/sh\nexec '${process.execPath}' '${resolve('src/main/askpass.cjs')}' "$@"\n`, { mode: 0o700 });
  const knownHostsFile = join(dir, 'known_hosts');
  const tunnel = new TunnelManager({ askpassPath: helper, askpassPort: broker.port, askpassToken: broker.token, knownHostsFile });
  try {
    const url = await tunnel.connect({ id: 'integration', name: 'Integration', host: '127.0.0.1', username: 'test', port: fixture.sshPort, remotePort: fixture.webPort, identityFile: '' });
    assert.ok(url);
    assert.equal(tunnel.state.phase, 'connected');
    assert.ok(challenges.includes('host') && challenges.includes('secret'));
    assert.match(await (await fetch(url)).text(), /pi-web-app/);
    assert.ok((await readFile(knownHostsFile, 'utf8')).length > 0);
    assert.ok(!JSON.stringify(tunnel.state).includes(TEST_PASSWORD));
    const phases: string[] = [];
    const message = await tunnel.refreshEnvironment({ id: 'integration', name: 'Integration', host: '127.0.0.1', username: 'test', port: fixture.sshPort, remotePort: fixture.webPort, identityFile: '' }, await readFile('src/main/refresh-environment.py', 'utf8'), (state) => phases.push(state.phase));
    assert.match(message, /服务健康检查通过/);
    assert.deepEqual(phases, ['checking', 'reading', 'restarting']);
    assert.equal(tunnel.state.phase, 'connected');
    assert.equal(fixture.environmentRuns, 1);
    assert.equal(challenges.filter((kind) => kind === 'secret').length, 2);
    const disconnected = once(tunnel, 'state');
    fixture.disconnectClients();
    await disconnected;
    assert.equal(tunnel.state.phase, 'error');
  } finally {
    await tunnel.disconnect(); await broker.close(); await fixture.close(); await rm(dir, { recursive: true, force: true });
  }
});
