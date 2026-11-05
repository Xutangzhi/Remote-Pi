import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPreviewIsolation } from '../preview-isolation-checks';
import { startFixture, TEST_PASSWORD } from '../fixtures';

test('preview component failures stay inside the panel and allow closing and recovery', async () => {
  const fixture = await startFixture();
  fixture.previewFiles.set('healthy.csv', Buffer.from('状态\n仍能预览'));
  for (const path of ['preview.pdf', 'preview.docx', 'preview.pptx']) fixture.previewFiles.set(path, await readFile(`tests/assets/${path}`));
  fixture.histories.set('session-1', [{ entryId: 'previews', role: 'assistant', content: [...fixture.previewFiles.keys()].map((path) => `[${path}](${path})`).join('\n\n') }]);
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-preview-isolation-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
    await page.getByText('端口与私钥设置', { exact: false }).click();
    await page.getByLabel('SSH 端口', { exact: true }).fill(String(fixture.sshPort));
    await page.getByLabel('远端 Pi Web 端口', { exact: true }).fill(String(fixture.webPort));
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await page.getByRole('button', { name: '信任并连接', exact: true }).click();
    await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '继续连接', exact: true }).click();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
    const open = (name: string) => page.getByRole('link', { name, exact: true }).click();
    await desktop.evaluate(({ session }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, done) => {
        done({ cancel: /\/(PdfPreview|WordPreview)-[^/]+\.js$/.test(details.url) });
      });
    });
    await checkPreviewIsolation(page, open);
    expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible() || window.isFocused()))).toBe(false);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
