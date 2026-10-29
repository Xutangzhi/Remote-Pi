import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

test('dialogs contain keyboard focus, preserve the draft, and ignore new-chat shortcuts until dismissed', async () => {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-dialog-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    const shortcut = process.platform === 'darwin' ? 'Meta+n' : 'Control+n';
    await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
    await page.getByText('端口与私钥设置', { exact: false }).click();
    await page.getByLabel('SSH 端口', { exact: true }).fill(String(fixture.sshPort));
    await page.getByLabel('远端 Pi Web 端口', { exact: true }).fill(String(fixture.webPort));
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await page.getByRole('button', { name: '信任并连接', exact: true }).click();
    await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '继续连接', exact: true }).click();
    const input = page.getByLabel('发送消息', { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('打开对话框也应保留的草稿');
    await input.press(shortcut);
    const newDialog = page.getByRole('dialog', { name: '新建对话', exact: true });
    await expect(newDialog).toBeVisible();
    await expect(newDialog.getByLabel('选择项目', { exact: true })).toBeFocused();
    await newDialog.getByRole('button', { name: '创建对话', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(newDialog.getByLabel('关闭对话框', { exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(newDialog.getByRole('button', { name: '创建对话', exact: true })).toBeFocused();
    // A late async callback must not be able to move focus behind the modal.
    await input.focus();
    await expect(newDialog.getByLabel('选择项目', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(newDialog).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('打开对话框也应保留的草稿');

    await page.getByLabel('对话菜单', { exact: true }).click();
    await page.getByRole('button', { name: '重命名对话', exact: true }).click();
    const rename = page.getByRole('dialog', { name: '重命名对话', exact: true });
    await rename.getByLabel('对话名称', { exact: true }).fill('尚未保存的名称');
    await page.keyboard.press(shortcut);
    await expect(rename).toBeVisible();
    await expect(rename.getByLabel('对话名称', { exact: true })).toHaveValue('尚未保存的名称');
    await page.keyboard.press('Escape');
    await expect(rename).toHaveCount(0);

    await input.fill('/model');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const command = page.getByRole('dialog', { name: '选择模型', exact: true });
    const model = command.getByLabel('选择模型', { exact: true });
    await expect(model).toBeFocused();
    await model.selectOption({ label: 'Second model · fixture' });
    await command.getByRole('button', { name: '确认', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(model).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(command.getByRole('button', { name: '确认', exact: true })).toBeFocused();
    await page.keyboard.press(shortcut);
    await expect(command).toBeVisible();
    await expect(newDialog).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(command).toHaveCount(0);
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
