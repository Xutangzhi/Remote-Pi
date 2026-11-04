import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

test('chat file references open remote previews and recover after errors and navigation', async () => {
  const fixture = await startFixture();
  fixture.histories.set('session-1', [{ entryId: 'files', role: 'assistant', content: [
    '[报告](/srv/projects/remote-pi/docs/report.md:12)',
    '`src/main.ts`',
    '[带空格的文件](docs/my%20file.txt#L3)',
    '[文件 URL](file:///srv/projects/remote-pi/README.md)',
    '[失败文件](missing.txt)',
    '[延迟文件](slow.txt)',
    '[第二份报告](docs/second.md)',
    '```text\nsrc/not-a-link.ts\n```',
  ].join('\n\n') }]);
  fixture.fileContents.set('docs/report.md', '# Remote Pi\n\n[相邻文档](./next.md)\n\n[上级文档](../README.md)');
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-file-links-'));
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

    await page.getByRole('link', { name: '报告', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('docs/report.md');
    await expect(page.locator('.file-preview').getByRole('heading', { name: 'Remote Pi' })).toBeVisible();
    await page.locator('.file-preview').getByRole('link', { name: '相邻文档', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('docs/next.md');
    await page.getByRole('link', { name: '报告', exact: true }).click();
    await page.locator('.file-preview').getByRole('link', { name: '上级文档', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('README.md');
    await page.getByRole('link', { name: '报告', exact: true }).click();
    await page.getByRole('button', { name: '原文', exact: true }).click();
    await expect(page.locator('pre.file-preview')).toContainText('# Remote Pi');
    await page.getByRole('link', { name: 'src/main.ts', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('src/main.ts');
    await expect(page.locator('pre.file-preview')).toBeVisible();
    await expect(page.getByRole('link', { name: 'src/not-a-link.ts', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: '带空格的文件', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('docs/my file.txt');
    await page.getByRole('link', { name: '文件 URL', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('README.md');
    await page.getByLabel('关闭面板', { exact: true }).click();
    await expect(page.locator('.inspector')).toHaveCount(0);
    await page.getByRole('link', { name: '报告', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('docs/report.md');

    fixture.fileReadErrors.add('missing.txt');
    await page.getByRole('link', { name: '失败文件', exact: true }).click();
    await expect(page.locator('.panel-error')).toContainText('missing.txt');
    await expect(page.locator('.file-preview')).toHaveCount(0);
    await page.getByRole('link', { name: '报告', exact: true }).click();
    await expect(page.locator('.file-preview')).toBeVisible();
    await expect(page.locator('.panel-error')).toHaveCount(0);

    fixture.fileReadDelay.set('slow.txt', 700);
    await page.getByRole('link', { name: '延迟文件', exact: true }).click();
    await page.getByRole('link', { name: '第二份报告', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('docs/second.md');
    await page.waitForTimeout(850);
    await expect(page.locator('.file-back')).toHaveText('docs/second.md');
    await page.getByRole('button', { name: 'docs/second.md', exact: true }).click();
    await expect(page.locator('.directory-path')).toContainText('docs');
    await expect(page.locator('.file-preview')).toHaveCount(0);
    await page.getByRole('link', { name: '第二份报告', exact: true }).click();
    await expect(page.locator('.file-back')).toHaveText('docs/second.md');
    await page.locator('li[data-session-id="session-3"] > .conversation-tree-row > .conversation-row').click();
    await expect(page.locator('.file-preview')).toHaveCount(0);
    if (env.REMOTE_PI_TEST_SHOW_WINDOWS !== '1') expect(await backgroundWindowState()).toEqual([{ visible: false, focusable: false, focused: false }]);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
