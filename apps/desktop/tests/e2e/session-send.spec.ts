import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

async function connectedFixture() {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-send-'));
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
    return { fixture, page, async close() { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

test('pending submissions stay locked per session across switches and settle while another session is selected', async () => {
  const setup = await connectedFixture();
  const { fixture, page } = setup;
  try {
    fixture.promptResponseDelay.set('session-1', 2500);
    const input = page.getByLabel('发送消息', { exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    const pickA = page.locator('li[data-session-id="session-1"] > .conversation-tree-row > .conversation-row');
    const pickB = page.locator('li[data-session-id="session-2"] > .conversation-tree-row > .conversation-row');
    await input.fill('第一条延迟确认的输入');
    await send.click();
    await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('session-1/prompt')).length).toBe(1);
    await pickB.click();
    await expect(input).toBeEnabled();
    await input.fill('另一个会话仍能输入');
    await pickA.click();
    await expect(input).toHaveValue('第一条延迟确认的输入');
    await expect(input).toBeDisabled();
    await expect(send).toBeDisabled();
    await expect(input).toBeEnabled({ timeout: 5000 });
    await expect(input).toHaveValue('');
    expect(fixture.calls.filter((call) => call.path.endsWith('session-1/prompt'))).toHaveLength(1);
    await input.fill('第二条延迟确认的输入');
    await send.click();
    await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('session-1/prompt')).length).toBe(2);
    await pickB.click();
    await expect(input).toHaveValue('另一个会话仍能输入');
    await expect(page.getByTestId('message-assistant').first()).toContainText('主机指纹确认');
    await page.waitForTimeout(2700);
    await expect(input).toHaveValue('另一个会话仍能输入');
    await pickA.click();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('');
    await input.fill('上一条完成后写的新草稿');
    await pickB.click();
    await pickA.click();
    await expect(input).toHaveValue('上一条完成后写的新草稿');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(2);
  } finally { await setup.close(); }
});

test('a command that restores the current session draft does not erase its replacement on completion', async () => {
  const setup = await connectedFixture();
  const { fixture, page } = setup;
  try {
    fixture.commandResults.set('/restore-draft', { type: 'done', session: fixture.sessions[0]!, promptDraft: '应保留的原始提问' });
    const input = page.getByLabel('发送消息', { exact: true });
    await input.fill('/restore-draft');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('应保留的原始提问');
    await page.locator('li[data-session-id="session-2"] > .conversation-tree-row > .conversation-row').click();
    await page.locator('li[data-session-id="session-1"] > .conversation-tree-row > .conversation-row').click();
    await expect(input).toHaveValue('应保留的原始提问');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
  } finally { await setup.close(); }
});
