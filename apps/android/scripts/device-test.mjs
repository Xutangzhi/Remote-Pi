import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { startFixture, TEST_PASSWORD, TEST_PRIVATE_KEY, TEST_KEY_PASSPHRASE } from '../tests/fixtures.ts';
const sdk = process.env.ANDROID_HOME || resolve(homedir(), 'Library/Android/sdk');
const adbPath = resolve(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = existsSync(adbPath) ? adbPath : 'adb';
const run = (command, args, capture = false) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  let output = ''; child.stdout?.on('data', (data) => output += data);
  child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(Error(`${command} exited with ${code}`)));
});
await run(adb, ['get-state']); // Requires one connected test device, or ANDROID_SERIAL.
await run(process.execPath, ['scripts/android-build.mjs', ':app:assembleDebug', ':app:assembleDebugAndroidTest']);
await run(adb, ['install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk']);
await run(adb, ['install', '-r', 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']);
const fixture = await startFixture(); let port;
try {
  port = await run(adb, ['reverse', 'tcp:0', `tcp:${fixture.sshPort}`], true);
  if (!/^\d+$/.test(port)) throw Error('ADB did not allocate a reverse port');
  const output = await run(adb, ['shell', 'am', 'instrument', '-w', '-e', 'notClass', 'dev.remotepi.android.RealServerTest', '-e', 'sshPort', port, '-e', 'webPort', String(fixture.webPort), '-e', 'password', TEST_PASSWORD, '-e', 'privateKey', Buffer.from(TEST_PRIVATE_KEY).toString('base64'), '-e', 'passphrase', TEST_KEY_PASSPHRASE, 'dev.remotepi.android.test/androidx.test.runner.AndroidJUnitRunner'], true);
  console.log(output);
  if (!output.includes('OK (6 tests)')) throw Error('Android device tests did not all pass. The full suite requires a test device running Android 11 or newer.');
} finally {
  if (port) await run(adb, ['reverse', '--remove', `tcp:${port}`]).catch(() => {});
  await fixture.close();
}
