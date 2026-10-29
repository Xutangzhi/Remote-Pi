import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsStore, validateProfile } from '../src/main/profiles';
import { sshArguments } from '../src/main/tunnel';

export const example = { id: 'test-server', name: 'Development', host: 'dev-server', username: '', port: null, remotePort: 8504, identityFile: '' };

test('rejects command/option injection and invalid ports at the IPC boundary', () => {
  for (const host of ['-oProxyCommand=whoami', 'host;touch /tmp/x', 'host\n-oForwardAgent=yes', 'user@host', 'host $(whoami)']) {
    assert.throws(() => validateProfile({ ...example, host }));
  }
  for (const port of [0, 65536, 1.5, '22']) assert.throws(() => validateProfile({ ...example, port }));
  assert.throws(() => validateProfile({ ...example, identityFile: '~/.ssh/id_ed25519' }));
  assert.equal(validateProfile({ ...example, host: '2001:db8::1' }).host, '2001:db8::1');
});

test('leaves SSH config port/user/identity unspecified unless explicitly overridden', () => {
  const args = sshArguments(example, 12345);
  assert.equal(args.at(-1), 'dev-server');
  assert.ok(args.includes('127.0.0.1:12345:127.0.0.1:8504'));
  assert.ok(!args.includes('-p') && !args.includes('-l') && !args.includes('-i'));
  assert.ok(args.includes('StrictHostKeyChecking=ask'));
});

test('persists only non-secret fields, restores profiles and serializes concurrent writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-store-'));
  try {
    const file = join(dir, 'settings.json');
    const store = new SettingsStore(file);
    await store.load();
    await Promise.all([store.saveProfile({ ...example, password: 'must-not-persist', passphrase: 'also-secret' }), store.setTheme('dark')]);
    const text = await readFile(file, 'utf8');
    assert.ok(!text.includes('must-not-persist') && !text.includes('also-secret'));
    const restored = await new SettingsStore(file).load();
    assert.equal(restored.theme, 'dark');
    assert.deepEqual(restored.profiles, [example]);
    await store.deleteProfile(example.id);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).profiles, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
