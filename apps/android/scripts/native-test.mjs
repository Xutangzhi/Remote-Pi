import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFixture, TEST_PASSWORD, TEST_PRIVATE_KEY, TEST_KEY_PASSPHRASE } from '../tests/fixtures.ts';
await mkdir('work', { recursive: true });
const directory = await mkdtemp(resolve('work/native-key-'));
const key = resolve(directory, 'test-key');
await writeFile(key, TEST_PRIVATE_KEY, { mode: 0o600 });
const fixture = await startFixture();
const env = { ...process.env, REMOTE_PI_TEST_SSH_PORT: String(fixture.sshPort), REMOTE_PI_TEST_WEB_PORT: String(fixture.webPort), REMOTE_PI_TEST_PASSWORD: TEST_PASSWORD, REMOTE_PI_TEST_KEY: key, REMOTE_PI_TEST_PASSPHRASE: TEST_KEY_PASSPHRASE };
try {
  const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ['scripts/android-build.mjs', 'testDebugUnitTest', '--rerun-tasks'], { env, stdio: 'inherit' }); child.on('error', reject); child.on('exit', resolve); });
  process.exitCode = code ?? 1;
} finally { await fixture.close(); await rm(directory, { recursive: true, force: true }); }
