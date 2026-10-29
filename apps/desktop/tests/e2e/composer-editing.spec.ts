import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

async function openFixture() {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-composer-editing-'));
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ profiles: [{ id: 'fixture', name: 'Composer fixture', host: '127.0.0.1', username: 'test', port: fixture.sshPort, remotePort: fixture.webPort, identityFile: '' }], theme: 'light' }));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await page.getByRole('button', { name: '信任并连接', exact: true }).click();
    await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '继续连接', exact: true }).click();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
    return { fixture, desktop, page, async close() { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

test('editing a reference in the middle replaces its suffix and keeps the following draft', async () => {
  const { fixture, page, close } = await openFixture();
  const input = page.getByLabel('发送消息', { exact: true });
  try {
    for (const example of [
      { marked: 'read @REA|DME.md then summarize', option: /README.md/, expected: 'read @README.md  then summarize' },
      { marked: '/skill:rev|iew inspect the changes', option: /\/skill:review/, expected: '/skill:review  inspect the changes' },
      { marked: 'read @"docs/my| file.md" then summarize', option: /docs\/my file.md/, expected: 'read @"docs/my file.md"  then summarize' },
    ]) {
      await input.fill(example.marked.replace('|', ''));
      await input.evaluate((node: HTMLTextAreaElement, cursor) => node.setSelectionRange(cursor + 1, cursor + 1), example.marked.indexOf('|'));
      await input.press('ArrowLeft');
      await page.getByRole('option', { name: example.option }).click();
      await expect(input).toHaveValue(example.expected);
    }
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt') || call.path.endsWith('/commands/run'))).toHaveLength(0);
  } finally { await close(); }
});

test('a wrapped draft automatically grows and shrinks when the window width changes', async () => {
  const { desktop, page, close } = await openFixture();
  const input = page.getByLabel('发送消息', { exact: true });
  const height = () => input.evaluate((node) => node.getBoundingClientRect().height);
  try {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900));
    const draft = '这是一段用于检查窗口改变后的草稿，内容不会在调整侧栏时被修改。'.repeat(4);
    await input.fill(draft);
    await expect.poll(() => input.evaluate((node) => node.clientHeight >= node.scrollHeight)).toBe(true);
    const initialHeight = await height();
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 900));
    await expect.poll(height).toBeGreaterThan(initialHeight + 30);
    await expect(input).toHaveValue(draft);
    await expect.poll(height).toBeLessThanOrEqual(180);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900));
    await expect.poll(height).toBeCloseTo(initialHeight, 0);
    await expect(input).toHaveValue(draft);
  } finally { await close(); }
});
