import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

async function connect(page: Page, fixture: Awaited<ReturnType<typeof startFixture>>) {
  await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
  await page.getByText('端口与私钥设置', { exact: false }).click();
  await page.getByLabel('SSH 端口', { exact: true }).fill(String(fixture.sshPort));
  await page.getByLabel('远端 Pi Web 端口', { exact: true }).fill(String(fixture.webPort));
  await page.getByRole('button', { name: '连接工作台', exact: true }).click();
  await page.getByRole('button', { name: '信任并连接', exact: true }).click();
  await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '继续连接', exact: true }).click();
  await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
}

test('stale file reads cannot reopen previews or report errors after navigation, refresh or panel switches', async () => {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-file-races-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await connect(page, fixture);
    await page.getByLabel('文件面板', { exact: true }).click();
    fixture.fileReadDelay.set('README.md', 700);
    const beginRead = async () => {
      const previous = fixture.calls.filter((call) => call.path.endsWith('/file')).length;
      await page.getByRole('button', { name: 'README.md', exact: true }).click();
      await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('/file')).length).toBe(previous + 1);
    };
    await beginRead();
    await page.getByTitle('刷新面板', { exact: true }).click();
    await page.waitForTimeout(850);
    await expect(page.locator('.file-preview')).toHaveCount(0);
    await expect(page.locator('.panel-loading')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();

    await beginRead();
    await page.getByRole('button', { name: 'src', exact: true }).click();
    await expect(page.locator('.directory-path')).toContainText('src');
    await page.waitForTimeout(850);
    await expect(page.locator('.file-preview')).toHaveCount(0);
    await expect(page.locator('.panel-loading')).toHaveCount(0);

    await page.getByLabel('上级目录', { exact: true }).click();
    fixture.fileReadErrors.add('README.md');
    await beginRead();
    await page.getByLabel('变更面板', { exact: true }).click();
    await expect(page.locator('.diff-content')).toContainText('+<Workspace />');
    await page.waitForTimeout(850);
    await expect(page.locator('.panel-error')).toHaveCount(0);
    await expect(page.locator('.panel-loading')).toHaveCount(0);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a delayed terminal connection preserves focus and typing in the Agent composer', async () => {
  const fixture = await startFixture();
  fixture.delayTerminalReady(1200);
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-terminal-focus-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await connect(page, fixture);
    await page.getByLabel('终端面板', { exact: true }).click();
    await expect(page.locator('.terminal-note')).toContainText('正在连接远端终端');
    const composer = page.getByLabel('发送消息', { exact: true });
    await composer.fill('保留草稿');
    await expect(page.locator('.terminal-pane')).toContainText('remote@test:');
    await expect(composer).toBeFocused();
    await page.keyboard.insertText('，继续输入');
    await expect(composer).toHaveValue('保留草稿，继续输入');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
