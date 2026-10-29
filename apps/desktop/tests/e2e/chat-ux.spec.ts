import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

async function connectedFixture() {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-chat-ux-'));
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
    return { fixture, desktop, page, async close() { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

test('text drafts and the selected session survive reload and a sent draft is removed', async () => {
  const { fixture, page, close } = await connectedFixture();
  try {
    const input = page.getByLabel('发送消息', { exact: true });
    const session = (id: string) => page.locator(`li[data-session-id="${id}"] > .conversation-tree-row > .conversation-row`);
    await input.fill('会话 A 的未发送文字');
    await session('session-2').click();
    await expect(page.getByTestId('message-assistant').first()).toContainText('主机指纹确认');
    await input.fill('会话 B 的未发送文字');
    await page.reload();
    await expect(input).toHaveValue('会话 B 的未发送文字');
    await expect(page.getByTestId('message-assistant').first()).toContainText('主机指纹确认');
    await session('session-1').click();
    await expect(input).toHaveValue('会话 A 的未发送文字');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toHaveValue('');
    await page.reload();
    await expect(page.getByTestId('message-assistant').last()).toContainText('测试流式回复');
    await expect(input).toHaveValue('');
    await session('session-2').click();
    await expect(input).toHaveValue('会话 B 的未发送文字');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(1);
  } finally { await close(); }
});

test('a delayed send completion does not steal focus from the terminal', async () => {
  const { fixture, page, close } = await connectedFixture();
  try {
    fixture.promptResponseDelay.set('session-1', 1800);
    const input = page.getByLabel('发送消息', { exact: true });
    await input.fill('等待确认的消息');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('/prompt')).length).toBe(1);
    await page.getByLabel('终端面板', { exact: true }).click();
    const terminal = page.locator('.terminal-pane .xterm-helper-textarea');
    await expect(page.locator('.terminal-pane')).toContainText('remote@test:');
    await terminal.focus();
    await expect(input).toHaveValue('');
    await expect(terminal).toBeFocused();
    await page.keyboard.type('still-in-terminal');
    await expect(page.locator('.terminal-pane')).toContainText('still-in-terminal');
    await expect(input).toHaveValue('');
    await input.fill('键盘发送后继续输入');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
  } finally { await close(); }
});

test('bottom-follow responds to layout changes without pulling a reader away from earlier messages', async () => {
  const { fixture, desktop, page, close } = await connectedFixture();
  try {
    fixture.histories.set('session-1', Array.from({ length: 25 }, (_, index) => ({ entryId: `long-${index}`, role: 'assistant', content: `消息 ${index}\n\n${'这段内容用于检查调整面板后的阅读位置。'.repeat(12)}` })));
    await page.reload();
    const scroll = page.locator('.transcript-scroll');
    const distance = () => scroll.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
    await expect(page.getByTestId('message-assistant')).toHaveCount(25);
    await expect.poll(distance).toBeLessThan(2);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 800));
    await page.getByLabel('文件面板', { exact: true }).click();
    await expect(page.getByRole('separator', { name: '调整面板高度', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.inspector').evaluate((node) => node.getAnimations().every((animation) => animation.playState !== 'running'))).toBe(true);
    await expect.poll(distance).toBeLessThan(2);
    await page.getByLabel('发送消息', { exact: true }).fill('多行草稿\n'.repeat(6));
    await expect.poll(distance).toBeLessThan(2);
    await scroll.evaluate((node) => { node.scrollTop = 300; });
    await expect(page.getByLabel('回到底部', { exact: true })).toBeVisible();
    await page.getByLabel('关闭面板', { exact: true }).click();
    await expect(page.locator('.inspector')).toHaveCount(0);
    expect(await distance()).toBeGreaterThan(1000);
    await expect(page.getByLabel('回到底部', { exact: true })).toBeVisible();
    await page.getByLabel('回到底部', { exact: true }).click();
    await expect.poll(distance).toBeLessThan(2);
  } finally { await close(); }
});

test('a reconnect keeps the draft editable while blocking submissions', async () => {
  const { fixture, page, close } = await connectedFixture();
  try {
    fixture.snapshotDelay.set('session-1', 1600);
    fixture.closeStreams('session-1');
    await expect(page.locator('.stream-notice')).toBeVisible();
    const input = page.getByLabel('发送消息', { exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    await expect(input).toBeEnabled();
    await input.fill('恢复连接时继续写草稿');
    await input.press('Enter');
    await expect(input).toHaveValue('恢复连接时继续写草稿');
    await expect(send).toBeDisabled();
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
    await expect(send).toBeEnabled({ timeout: 10000 });
    await expect(input).toHaveValue('恢复连接时继续写草稿');
  } finally { await close(); }
});
