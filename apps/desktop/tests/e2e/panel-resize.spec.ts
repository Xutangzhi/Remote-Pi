import { test, expect, _electron as electron, type Locator, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

async function connectedFixture() {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-resize-'));
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
    await expect(page.locator('.stream-notice')).toHaveCount(0);
    return { fixture, desktop, page, async close() { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

const width = (element: Locator) => element.evaluate((node) => node.getBoundingClientRect().width);
const height = (element: Locator) => element.evaluate((node) => node.getBoundingClientRect().height);
async function settled(element: Locator) {
  await expect.poll(() => element.evaluate((node) => node.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity))).toBe(true);
}
async function drag(page: Page, handle: Locator, dx: number, dy = 0) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test('both sidebars resize independently, preserve terminal and draft, and restore widths after reopening or reload', async () => {
  const { fixture, desktop, page, close } = await connectedFixture();
  const left = page.locator('.project-sidebar'); const right = page.locator('.inspector');
  const leftHandle = page.getByRole('separator', { name: '调整左侧栏宽度', exact: true });
  const rightHandle = page.getByRole('separator', { name: '调整右侧栏宽度', exact: true });
  try {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 900));
    await page.getByLabel('文件面板', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
    await settled(left); await settled(right);
    await expect(leftHandle).toHaveAttribute('aria-orientation', 'vertical');
    await expect(rightHandle).toHaveAttribute('aria-orientation', 'vertical');
    const originalLeft = await width(left); const originalRight = await width(right);
    await drag(page, leftHandle, 66);
    await expect.poll(() => width(left)).toBeCloseTo(originalLeft + 66, 0);
    expect(await width(right)).toBeCloseTo(originalRight, 0);
    await drag(page, rightHandle, -90);
    await expect.poll(() => width(right)).toBeCloseTo(originalRight + 90, 0);
    const savedLeft = await width(left); const savedRight = await width(right);
    expect(await page.locator('.conversation-main').evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320);
    await page.getByLabel('变更面板', { exact: true }).click();
    await expect(page.locator('.diff-content')).toContainText('+<Workspace />');
    await expect.poll(() => width(right)).toBeCloseTo(savedRight, 0);
    await page.getByLabel('终端面板', { exact: true }).click();
    await expect(page.locator('.terminal-pane')).toContainText('remote@test:');
    await expect.poll(() => width(right)).toBeCloseTo(savedRight, 0);
    const terminalCreates = fixture.calls.filter((call) => call.path.endsWith('/terminal.create')).length;
    const terminalInput = page.locator('.terminal-pane .xterm-helper-textarea');
    await terminalInput.evaluate((node) => { node.dataset.resizeProbe = 'same-terminal'; });
    await page.getByLabel('发送消息', { exact: true }).fill('调整宽度时保留的草稿');
    await drag(page, rightHandle, 50);
    await expect.poll(() => width(right)).toBeCloseTo(savedRight - 50, 0);
    await expect(terminalInput).toHaveAttribute('data-resize-probe', 'same-terminal');
    expect(fixture.calls.filter((call) => call.path.endsWith('/terminal.create'))).toHaveLength(terminalCreates);
    await terminalInput.focus();
    await page.keyboard.type('resize-keeps-terminal');
    await expect(page.locator('.terminal-pane')).toContainText('resize-keeps-terminal');
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('调整宽度时保留的草稿');
    const finalRight = await width(right);
    await page.getByLabel('关闭面板', { exact: true }).click();
    await expect(right).toHaveCount(0);
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(left).toHaveCount(0);
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await page.getByLabel('文件面板', { exact: true }).click();
    await expect.poll(() => width(left)).toBeCloseTo(savedLeft, 0);
    await expect.poll(() => width(right)).toBeCloseTo(finalRight, 0);
    await page.reload();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
    await page.getByLabel('文件面板', { exact: true }).click();
    await expect.poll(() => width(left)).toBeCloseTo(savedLeft, 0);
    await expect.poll(() => width(right)).toBeCloseTo(finalRight, 0);
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
  } finally { await close(); }
});

test('hover sidebar can be resized without closing mid-drag and retains mouse-leave behavior', async () => {
  const { page, close } = await connectedFixture();
  const sidebar = page.locator('.project-sidebar');
  const handle = page.getByRole('separator', { name: '调整左侧栏宽度', exact: true });
  try {
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(sidebar).toHaveCount(0);
    const chat = await page.locator('.conversation-main').boundingBox();
    await page.mouse.move(2, 200);
    await expect(handle).toBeVisible(); await settled(sidebar);
    const original = await width(sidebar);
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2; const y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 65, y, { steps: 12 });
    await expect(handle).toBeVisible();
    await expect.poll(() => width(sidebar)).toBeCloseTo(original + 65, 0);
    expect(await page.locator('.conversation-main').boundingBox()).toEqual(chat);
    await page.mouse.up();
    await page.mouse.move(1100, 200);
    await expect(sidebar).toHaveCount(0);
    await page.mouse.move(2, 200);
    await expect(handle).toBeVisible();
    await expect.poll(() => width(sidebar)).toBeCloseTo(original + 65, 0);
    await page.mouse.move(1100, 200);
    await expect(sidebar).toHaveCount(0);
  } finally { await close(); }
});

test('keyboard resizing and narrow-window clamps leave chat usable while the bottom panel height is adjustable', async () => {
  const { desktop, page, close } = await connectedFixture();
  const left = page.locator('.project-sidebar'); const panel = page.locator('.inspector');
  const leftHandle = page.getByRole('separator', { name: '调整左侧栏宽度', exact: true });
  try {
    await settled(left);
    const originalLeft = await width(left);
    await leftHandle.focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => width(left)).toBeCloseTo(originalLeft + 16, 0);
    await page.keyboard.press('Home'); const minLeft = Number(await leftHandle.getAttribute('aria-valuemin'));
    await expect.poll(() => width(left)).toBeCloseTo(minLeft, 0);
    await page.keyboard.press('End');
    await expect.poll(() => width(left)).toBeCloseTo(Number(await leftHandle.getAttribute('aria-valuemax')), 0);
    await page.getByLabel('文件面板', { exact: true }).click();
    const rightHandle = page.getByRole('separator', { name: '调整右侧栏宽度', exact: true });
    await expect(rightHandle).toBeVisible(); await settled(panel);
    const originalRight = await width(panel);
    await rightHandle.focus(); await page.keyboard.press('ArrowLeft');
    await expect.poll(() => width(panel)).toBeCloseTo(originalRight + 16, 0);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 800));
    const bottomHandle = page.getByRole('separator', { name: '调整面板高度', exact: true });
    await expect(bottomHandle).toHaveAttribute('aria-orientation', 'horizontal');
    await settled(left); await settled(panel);
    expect(await width(left)).toBeLessThanOrEqual(200);
    expect(await page.locator('.conversation-main').evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320);
    const originalHeight = await height(panel);
    await drag(page, bottomHandle, 0, -60);
    await expect.poll(() => height(panel)).toBeCloseTo(originalHeight + 60, 0);
    await bottomHandle.focus(); await page.keyboard.press('End');
    await expect.poll(() => height(panel)).toBeCloseTo(Number(await bottomHandle.getAttribute('aria-valuemax')), 0);
    await expect.poll(() => height(panel)).toBeLessThanOrEqual(480);
    expect(await page.locator('.conversation-main').evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(320);
    await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
    await expect(page.getByLabel('关闭面板', { exact: true })).toBeInViewport();
    const savedHeight = await height(panel);
    await page.getByLabel('关闭面板', { exact: true }).click(); await expect(panel).toHaveCount(0);
    await page.getByLabel('文件面板', { exact: true }).click();
    await expect.poll(() => height(panel)).toBeCloseTo(savedHeight, 0);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 480));
    await expect.poll(() => height(panel)).toBeLessThanOrEqual(160);
    await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
    await expect(page.getByLabel('关闭面板', { exact: true })).toBeInViewport();
  } finally { await close(); }
});
