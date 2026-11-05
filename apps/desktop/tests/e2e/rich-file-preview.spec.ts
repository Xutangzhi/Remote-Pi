import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { utils, write } from 'xlsx';
import { checkDocumentPreviews } from '../document-preview-checks';
import { startFixture, TEST_PASSWORD } from '../fixtures';

test('remote tables, images and media preview without leaving the workspace', async ({}, testInfo) => {
  const fixture = await startFixture();
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet([['产品', '数量'], ['测试商品', 42]]), '库存');
  utils.book_append_sheet(book, utils.aoa_to_sheet([['第二页数据']]), '说明');
  fixture.previewFiles.set('table.xlsx', write(book, { type: 'buffer', bookType: 'xlsx' }));
  fixture.previewFiles.set('data.csv', Buffer.from('名称,编号\n中文,001'));
  fixture.previewFiles.set('clip.webm', await readFile('tests/assets/preview.webm'));
  fixture.previewFiles.set('sound.wav', await readFile('tests/assets/preview.wav'));
  fixture.previewFiles.set('broken.xlsx', Buffer.from('not xlsx'));
  fixture.previewFiles.set('bad.mp4', Buffer.from('not video'));
  fixture.previewFiles.set('large.csv', Buffer.alloc(10 * 1024 * 1024 + 1));
  fixture.previewFiles.set('image.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64'));
  for (const path of ['preview.pdf', 'locked.pdf', 'preview.docx', 'preview.pptx']) fixture.previewFiles.set(path, await readFile(`tests/assets/${path}`));
  for (const path of ['broken.pdf', 'broken.docx', 'broken.pptx', 'legacy.doc', 'legacy.ppt']) fixture.previewFiles.set(path, Buffer.from('broken'));
  fixture.histories.set('session-1', [{ entryId: 'previews', role: 'assistant', content: [...fixture.previewFiles.keys(), 'missing.csv'].map((path) => `[${path}](${path})`).join('\n\n') }]);
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-preview-'));
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
    await open('table.xlsx');
    await expect(page.getByRole('cell', { name: '测试商品', exact: true })).toBeVisible();
    await page.getByLabel('选择工作表').selectOption({ label: '说明' });
    await expect(page.getByRole('cell', { name: '第二页数据', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('spreadsheet.png'), animations: 'disabled' });
    await open('data.csv');
    await expect(page.getByRole('cell', { name: '001', exact: true })).toBeVisible();
    await open('image.png');
    await expect.poll(() => page.locator('.image-preview img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    for (const [path, tag] of [['clip.webm', 'video'], ['sound.wav', 'audio']]) {
      await open(path!);
      const media = page.locator(`.rich-file-preview ${tag}`);
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThanOrEqual(1);
      await media.evaluate(async (element: HTMLMediaElement) => { element.muted = true; await element.play(); });
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(0);
      await media.evaluate((element: HTMLMediaElement) => { element.pause(); element.currentTime = 1; });
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeCloseTo(1, 1);
    }
    await open('broken.xlsx'); await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('无法解析');
    await open('bad.mp4'); await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('无法播放');
    await open('large.csv'); await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('10 MiB');
    await open('missing.csv'); await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('HTTP 404');
    await open('table.xlsx'); await expect(page.getByRole('cell', { name: '测试商品', exact: true })).toBeVisible();
    await checkDocumentPreviews(page, open, async (name) => {
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' });
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
      await page.screenshot({ path: testInfo.outputPath(`${name}-dark.png`), animations: 'disabled' });
      await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    });
    await page.screenshot({ path: testInfo.outputPath('document.png'), animations: 'disabled' });
    await page.getByLabel('关闭面板', { exact: true }).click(); await expect(page.locator('.rich-file-preview')).toHaveCount(0);
    expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible() || window.isFocused()))).toBe(false);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
