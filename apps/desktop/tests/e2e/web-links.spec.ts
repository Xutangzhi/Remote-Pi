import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

import { createServer } from 'node:http';
test('web links keep a visible return control, report failures and preserve the chat', async ({}, testInfo) => {
  const fixture = await startFixture();
  let slowImageRequested = false; let bodyReady = false;
  const web = createServer((request, response) => {
    if (request.url === '/slow') return;
    if (request.url === '/slow-image') { slowImageRequested = true; return; }
    if (request.url === '/body-ready') { bodyReady = true; response.end(); return; }
    if (request.url === '/broken') { response.destroy(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/slow-resource') {
      response.end('<!doctype html><h1>正文已就绪</h1><img src="/slow-image"><script>document.addEventListener("DOMContentLoaded", () => fetch("/body-ready"));</script>');
      return;
    }
    response.end('<!doctype html><h1>独立网页内容</h1>');
  });
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(web.address() as { port: number }).port}`;
  fixture.histories.set('session-1', [{ entryId: 'links', role: 'assistant', content: `[正常网页](${base}/good) [加载失败网页](${base}/broken) [加载中网页](${base}/slow) [慢图片网页](${base}/slow-resource)` }]);
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-web-links-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    const backgroundWindowState = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({ visible: window.isVisible(), focusable: window.isFocusable(), focused: window.isFocused() })));
    if (env.REMOTE_PI_TEST_SHOW_WINDOWS !== '1') expect(await backgroundWindowState()).toEqual([{ visible: false, focusable: false, focused: false }]);
    await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
    await page.getByText('端口与私钥设置', { exact: false }).click();
    await page.getByLabel('SSH 端口', { exact: true }).fill(String(fixture.sshPort));
    await page.getByLabel('远端 Pi Web 端口', { exact: true }).fill(String(fixture.webPort));
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await page.getByRole('button', { name: '信任并连接', exact: true }).click();
    await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '继续连接', exact: true }).click();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();

    const mainURL = page.url();
    const composer = page.getByLabel('发送消息', { exact: true });
    await composer.fill('浏览网页时保留的草稿');
    const open = async (name: string) => {
      const next = desktop.waitForEvent('window');
      await page.getByRole('link', { name, exact: true }).click();
      const browser = await next;
      await expect(browser.getByRole('button', { name: '关闭网页 · 返回聊天', exact: true })).toBeVisible();
      expect(page.url()).toBe(mainURL);
      await expect(composer).toHaveValue('浏览网页时保留的草稿');
      return browser;
    };
    const webViewState = () => desktop.evaluate(({ BrowserWindow }) => {
      const child = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Remote Pi · Browser')!;
      const view = child.contentView.children.find((view) => 'webContents' in view) as Electron.WebContentsView;
      return { visible: view.getVisible(), loading: view.webContents.isLoading() };
    });
    const slowResource = await open('慢图片网页');
    await expect.poll(() => slowImageRequested && bodyReady).toBe(true);
    await expect.poll(webViewState).toEqual({ visible: true, loading: true });
    await slowResource.getByRole('button', { name: '关闭网页 · 返回聊天', exact: true }).click();
    await expect.poll(() => desktop.windows().length).toBe(1);
    const browser = await open('正常网页');
    await expect.poll(() => desktop.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((contents) => contents.getURL() === url && !contents.isLoading()), `${base}/good`)).toBe(true);
    const isolated = await desktop.evaluate(async ({ BrowserWindow }) => {
      const child = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Remote Pi · Browser')!;
      const view = child.contentView.children.find((view) => 'webContents' in view) as Electron.WebContentsView;
      return { parent: child.getParentWindow()?.id, fullscreenable: child.isFullScreenable(), viewTop: view.getBounds().y, text: await view.webContents.executeJavaScript('document.body.textContent'), bridge: await view.webContents.executeJavaScript('typeof window.desktop'), url: view.webContents.getURL() };
    });
    expect(isolated).toEqual({ parent: undefined, fullscreenable: false, viewTop: 56, text: '独立网页内容', bridge: 'undefined', url: `${base}/good` });
    await desktop.evaluate(({ BrowserWindow }) => {
      const child = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Remote Pi · Browser')!;
      const view = child.contentView.children.find((view) => 'webContents' in view) as Electron.WebContentsView;
      view.webContents.forcefullyCrashRenderer();
    });
    await expect(browser.getByRole('alert')).toContainText('网页进程已退出');
    await expect.poll(async () => (await webViewState()).visible).toBe(false);
    await browser.getByRole('button', { name: '关闭网页 · 返回聊天', exact: true }).click();
    await expect.poll(() => desktop.windows().length).toBe(1);
    await desktop.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    const failed = await open('加载失败网页');
    await failed.emulateMedia({ colorScheme: null });
    await expect(failed.getByRole('alert')).toContainText('网页加载失败');
    await expect.poll(async () => (await webViewState()).visible).toBe(false);
    await expect.poll(() => failed.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await failed.screenshot({ path: testInfo.outputPath('browser-dark.png'), animations: 'disabled' });
    await failed.getByRole('button', { name: '关闭网页 · 返回聊天', exact: true }).click();
    await expect.poll(() => desktop.windows().length).toBe(1);
    const loading = await open('加载中网页');
    await loading.getByRole('button', { name: '关闭网页 · 返回聊天', exact: true }).click();
    await expect.poll(() => desktop.windows().length).toBe(1);
    await expect.poll(() => desktop.evaluate(({ webContents }) => webContents.getAllWebContents().length)).toBe(1);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByTestId('message-user').last()).toContainText('浏览网页时保留的草稿');
    await expect(page.getByTestId('message-assistant').last()).toContainText('已收到。');
    if (env.REMOTE_PI_TEST_SHOW_WINDOWS !== '1') expect(await backgroundWindowState()).toEqual([{ visible: false, focusable: false, focused: false }]);
  } finally { await desktop.close(); await fixture.close(); web.closeAllConnections(); await new Promise<void>((resolve) => web.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});
