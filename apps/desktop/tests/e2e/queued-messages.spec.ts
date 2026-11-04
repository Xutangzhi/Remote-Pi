import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

test('queued steer and follow-up messages can be cancelled or recalled without losing drafts or other entries', async () => {
  const fixture = await startFixture();
  fixture.startWork('session-1');
  fixture.setQueue('session-1', [{ kind: 'steer', text: 'adjust' }, { kind: 'followUp', text: 'next' }, { kind: 'followUp', text: 'image', hasAttachments: true, attachmentCount: 1 }]);
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-queue-'));
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


    const rows = page.locator('.queued-message-row');
    const input = page.getByLabel('发送消息', { exact: true });
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('引导：adjust');
    await input.fill('保留我的草稿');
    await expect(rows.nth(0).getByRole('button', { name: '撤回编辑', exact: true })).toBeDisabled();
    await rows.nth(1).getByRole('button', { name: '取消', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(input).toHaveValue('保留我的草稿');
    await input.fill('');
    await rows.nth(0).getByRole('button', { name: '撤回编辑', exact: true }).click();
    await expect(input).toHaveValue('adjust');
    await expect(page.getByLabel('发送方式')).toHaveValue('steer');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('含附件');
    await expect(rows.nth(0).getByRole('button', { name: '撤回编辑', exact: true })).toBeDisabled();
    await input.fill('edited adjustment');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toHaveValue('');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt')).map((call) => call.body)).toEqual([{ cwd: '/srv/projects/remote-pi', text: 'edited adjustment', streamingBehavior: 'steer' }]);
    await rows.nth(0).getByRole('button', { name: '取消', exact: true }).click();
    await expect(rows).toHaveCount(0);

    fixture.setQueue('session-1', [{ kind: 'steer', text: 'consumed' }, { kind: 'followUp', text: 'keep' }]);
    fixture.queueMutationDelay.set('session-1', 300);
    await expect(rows).toHaveCount(2);
    await rows.nth(0).getByRole('button', { name: '取消', exact: true }).click();
    fixture.setQueue('session-1', [{ kind: 'followUp', text: 'keep' }]);
    await expect(page.locator('.queued-messages [role="alert"]')).toContainText('队列已变化');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('keep');
    const before = fixture.calls.filter((call) => call.path.endsWith('/queue/message')).length;
    await rows.nth(0).getByRole('button', { name: '取消', exact: true }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(rows).toHaveCount(0);
    expect(fixture.calls.filter((call) => call.path.endsWith('/queue/message')).length).toBe(before + 1);

    fixture.startWork('session-1');
    fixture.setQueue('session-1', [{ kind: 'followUp', text: 'original session draft' }]);
    await expect(rows).toHaveCount(1);
    await rows.nth(0).getByRole('button', { name: '撤回编辑', exact: true }).click();
    await page.locator('li[data-session-id="session-2"] > .conversation-tree-row > .conversation-row').click();
    await input.fill('other session draft');
    await page.waitForTimeout(450);
    await expect(input).toHaveValue('other session draft');
    await page.locator('li[data-session-id="session-1"] > .conversation-tree-row > .conversation-row').click();
    await expect(input).toHaveValue('original session draft');
    await expect(page.getByLabel('发送方式')).toHaveValue('followUp');
    if (env.REMOTE_PI_TEST_SHOW_WINDOWS !== '1') expect(await backgroundWindowState()).toEqual([{ visible: false, focusable: false, focused: false }]);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
