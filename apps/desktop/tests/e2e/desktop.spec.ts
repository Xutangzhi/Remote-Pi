import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';

test('complete desktop flow: saved profile, in-app host/password auth, native projects/chat, stream, drafts, panels and disconnect', async () => {
  const fixture = await startFixture({ binaryFrames: true });
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-e2e-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: /你的远端工作台/ })).toBeVisible();
    await page.getByLabel('连接名称', { exact: true }).fill('Integration server');
    await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
    await page.getByLabel('用户名', { exact: true }).fill('test');
    await page.getByText('端口与私钥设置', { exact: false }).click();
    await page.getByLabel('SSH 端口', { exact: true }).fill(String(fixture.sshPort));
    await page.getByLabel('远端 Pi Web 端口', { exact: true }).fill(String(fixture.webPort));
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认服务器身份' })).toBeVisible();
    await page.getByRole('button', { name: '信任并连接' }).click();
    await expect(page.getByRole('dialog', { name: 'SSH 身份验证' })).toBeVisible();
    await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '继续连接', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '项目与对话' })).toBeVisible();
    await expect(page.getByTestId('message-assistant').first()).toContainText('项目侧栏');
    await expect(page.getByLabel('模型', { exact: true })).toBeEnabled();
    expect(await desktop.evaluate(({ webContents }) => webContents.getAllWebContents().filter((item) => item.getURL().startsWith('http://127.0.0.1:')).length)).toBe(0);
    await page.screenshot({ path: 'test-results/workspace-light.png' });
    await page.getByTestId('tool-card').getByText('read', { exact: true }).click();
    await expect(page.getByTestId('tool-card')).toContainText('Read 142 lines.');
    await page.getByLabel('发送消息', { exact: true }).fill('保留这份草稿');
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
    await expect(page.getByTestId('message-assistant').first()).toContainText('主机指纹确认');
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('');
    await page.getByLabel('发送消息', { exact: true }).fill('另一个对话的草稿');
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /重做远端工作台/ }).click();
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('保留这份草稿');
    await page.getByLabel('模型', { exact: true }).selectOption({ label: 'Second model · fixture' });
    await expect.poll(() => fixture.calls.some((call) => call.path.endsWith('/model') && call.body.modelId === 'second-model')).toBe(true);
    await page.getByLabel('发送消息', { exact: true }).fill('检查原生会话');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByTestId('message-user').last()).toContainText('检查原生会话');
    await expect(page.getByTestId('message-assistant').last()).toContainText('测试流式回复');
    await expect(page.getByTestId('message-assistant').filter({ hasText: '测试流式回复' })).toHaveCount(1);
    await expect(page.getByTestId('message-user').filter({ hasText: '检查原生会话' })).toHaveCount(1);
    fixture.closeStreams('session-1');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await expect(page.getByLabel('模型', { exact: true })).toBeEnabled({ timeout: 10000 });
    await expect(page.getByTestId('message-assistant').filter({ hasText: '测试流式回复' })).toHaveCount(1);
    await expect(page.getByTestId('message-user').filter({ hasText: '检查原生会话' })).toHaveCount(1);
    await page.getByLabel('发送消息', { exact: true }).fill('检查原生会话');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByTestId('message-assistant').filter({ hasText: '测试流式回复' })).toHaveCount(2);
    await expect(page.getByTestId('message-user').filter({ hasText: '检查原生会话' })).toHaveCount(2);
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt') && call.body.text === '检查原生会话')).toHaveLength(2);
    await page.getByLabel('文件面板', { exact: true }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(page.locator('.file-preview')).toContainText('A native desktop workspace.');
    await page.getByLabel('变更面板', { exact: true }).click();
    await expect(page.locator('.diff-content')).toContainText('+<Workspace />');
    await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    await page.screenshot({ path: 'test-results/workspace-diff.png' });
    await page.getByLabel('终端面板', { exact: true }).click();
    await expect(page.locator('.terminal-pane')).toContainText('remote@test:');
    await page.getByLabel('关闭面板', { exact: true }).click();
    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/workspace-dark.png', animations: 'disabled' });
    // A late snapshot from the previous conversation must not replace the new one.
    fixture.snapshotDelay.set('session-2', 700);
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
    await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('session-2/transcript-snapshot')).length).toBeGreaterThan(1);
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /重做远端工作台/ }).click();
    await expect(page.getByTestId('message-assistant').first()).toContainText('项目侧栏');
    await page.waitForTimeout(900);
    await expect(page.getByTestId('message-assistant').first()).toContainText('项目侧栏');
    await page.getByLabel('添加项目', { exact: true }).click();
    await page.getByLabel('远端目录', { exact: true }).fill('/srv/projects/new-project');
    await page.getByLabel('项目名称', { exact: true }).fill('New project');
    await page.getByLabel('目录不存在时创建', { exact: true }).check();
    await page.getByRole('button', { name: '添加并新建对话', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '项目与对话' })).toContainText('New project');
    await expect(page.getByRole('heading', { name: '从一个想法开始。' })).toBeVisible();
    expect(fixture.calls.find((call) => call.path.endsWith('/projects') && call.method === 'POST')?.body.create).toBe(true);
    expect(fixture.calls.filter((call) => call.path.endsWith('/trust'))).toHaveLength(0);
    await page.getByLabel('对话菜单', { exact: true }).click();
    await page.getByRole('button', { name: '重命名对话', exact: true }).click();
    await page.getByLabel('对话名称', { exact: true }).fill('新项目的规划');
    await page.getByRole('button', { name: '保存名称' }).click();
    await expect(page.getByRole('navigation', { name: '项目与对话' })).toContainText('新项目的规划');
    await page.getByLabel('对话菜单', { exact: true }).click();
    await page.getByRole('button', { name: '归档对话', exact: true }).click();
    await expect(page.locator('.archived-notice')).toBeVisible();
    await page.getByRole('button', { name: '恢复对话', exact: true }).click();
    await expect(page.locator('.archived-notice')).toHaveCount(0);
    await page.getByRole('button', { name: '在 New project 新建对话', exact: true }).click();
    await page.getByRole('button', { name: '创建对话', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => fixture.sessions.filter((session) => session.cwd === '/srv/projects/new-project').length).toBe(2);
    await page.getByLabel('对话菜单', { exact: true }).click();
    await page.getByRole('button', { name: '断开服务器', exact: true }).click();
    await expect(page.getByRole('heading', { name: /你的远端工作台/ })).toBeVisible();
    expect(fixture.requests).toBeGreaterThan(10);
    const config = await readFile(join(dir, 'settings.json'), 'utf8');
    expect(config).not.toContain(TEST_PASSWORD);
    expect(JSON.parse(config).profiles[0].name).toBe('Integration server');
    await page.screenshot({ path: 'test-results/connection-manager.png' });
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('cancel in-app host verification and retry without leaving an SSH connection behind', async () => {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-cancel-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: /你的远端工作台/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/welcome-light.png' });
    await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
    await page.getByText('端口与私钥设置', { exact: false }).click();
    await page.getByLabel('SSH 端口', { exact: true }).fill(String(fixture.sshPort));
    await page.getByLabel('远端 Pi Web 端口', { exact: true }).fill(String(fixture.webPort));
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认服务器身份' })).toBeVisible();
    await page.getByRole('button', { name: '取消连接', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '连接工作台', exact: true })).toBeEnabled();
    expect((await page.evaluate(() => window.desktop.getConnection())).phase).toBe('idle');
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认服务器身份' })).toBeVisible();
    await page.getByRole('button', { name: '信任并连接', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'SSH 身份验证' })).toBeVisible();
    await page.getByRole('button', { name: '取消连接', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '连接工作台', exact: true })).toBeEnabled();
    expect((await page.evaluate(() => window.desktop.getConnection())).phase).toBe('idle');
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('subagent conversations nest under their parent, preserve ancestry while searching and remain selectable', async () => {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-tree-'));
  const parent = fixture.sessions[0]!;
  fixture.sessions.push(
    { ...parent, id: 'child-review', path: '/sessions/child-review.jsonl', name: '审查 SSH 安全', parentSessionPath: `${parent.path}/`, agentSubsession: true, modified: '2099-10-20T00:00:00.000Z' },
    { ...parent, id: 'grandchild', path: '/sessions/grandchild.jsonl', name: '检查密钥权限', parentSessionPath: '/sessions/child-review.jsonl', agentSubsession: true },
    { ...parent, id: 'child-archive', path: '/sessions/child-archive.jsonl', name: '已完成的代理任务', parentSessionPath: parent.path, agentSubsession: true, archived: true },
  );
  fixture.histories.set('child-review', [{ role: 'assistant', entryId: 'review-answer', content: '这是子代理的独立会话记录。' }]);
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
    const parentRow = page.locator('li[data-session-id="session-1"]');
    const child = parentRow.locator('ul[aria-label="重做远端工作台 的子会话"] > li[data-session-id="child-review"]');
    const parentPick = parentRow.locator(':scope > .conversation-tree-row > .conversation-row');
    const expandParent = page.getByRole('button', { name: '展开 重做远端工作台 的子会话', exact: true });
    await expect(expandParent).toHaveAttribute('aria-expanded', 'false');
    await expect(child).toHaveCount(0);
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
    await parentPick.click();
    await expect(parentPick).toHaveAttribute('aria-current', 'page');
    await expect(child).toHaveCount(0);
    await expandParent.click();
    await expect(child).toBeVisible();
    await expect(child).toHaveAttribute('data-session-depth', '1');
    await expect(child.locator('li[data-session-id="grandchild"]')).toHaveCount(0);
    // A newer subagent must not become the default selected conversation.
    await expect(parentRow.locator(':scope > .conversation-tree-row > .conversation-row')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.session-tree > li[data-session-id="child-review"]')).toHaveCount(0);
    await child.locator(':scope > .conversation-tree-row > .conversation-row').click();
    await expect(page.getByTestId('message-assistant').first()).toContainText('子代理的独立会话记录');
    await expect(child.locator('li[data-session-id="grandchild"]')).toHaveCount(0);
    await page.getByRole('button', { name: '展开 审查 SSH 安全 的子会话', exact: true }).click();
    await expect(child.locator('li[data-session-id="grandchild"]')).toHaveAttribute('data-session-depth', '2');
    await page.screenshot({ path: 'test-results/subagent-hierarchy.png' });
    await page.getByRole('button', { name: '收起 重做远端工作台 的子会话', exact: true }).click();
    await expect(page.locator('li[data-session-id="child-review"]')).toHaveCount(0);
    await page.getByRole('button', { name: '刷新项目', exact: true }).click();
    await expect(page.getByRole('button', { name: '展开 重做远端工作台 的子会话', exact: true })).toBeVisible();
    await page.getByLabel('搜索项目和对话').fill('密钥权限');
    await expect(page.locator('li[data-session-id="session-1"] li[data-session-id="child-review"] li[data-session-id="grandchild"]')).toBeVisible();
    await expect(page.locator('li[data-session-id="session-2"]')).toHaveCount(0);
    await page.getByLabel('搜索项目和对话').fill('');
    await expect(page.locator('li[data-session-id="child-review"]')).toHaveCount(0);
    await page.getByRole('button', { name: '展开 重做远端工作台 的子会话', exact: true }).click();
    await page.getByRole('button', { name: '切换归档对话', exact: true }).click();
    await expect(parentRow.locator('li[data-session-id="child-archive"]')).toBeVisible();
    await expect(parentRow.locator('li[data-session-id="child-review"]')).toHaveCount(0);
    await page.getByRole('button', { name: '切换归档对话', exact: true }).click();
    await expect(child).toBeVisible();
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('blue running dots become persistent red unread dots and clear only after a successful view', async () => {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-indicators-'));
  const parent = fixture.sessions[0]!;
  fixture.sessions.push({ ...parent, id: 'child-state', path: '/sessions/child-state.jsonl', name: '执行子代理任务', parentSessionPath: parent.path, agentSubsession: true });
  fixture.histories.set('child-state', [{ role: 'assistant', entryId: 'child-state-answer', content: '子代理任务的执行结果。' }]);
  // Both states exist before this client connects; they must not depend on the
  // selected conversation's status or on observing a start event locally.
  fixture.startWork('child-state'); fixture.finishWork('session-2');
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
    await expect(page.getByTestId('message-assistant').first()).toContainText('项目侧栏');
    const row = (id: string) => page.locator(`li[data-session-id="${id}"] > .conversation-tree-row`);
    const pick = (id: string) => row(id).locator(':scope > .conversation-row').click();
    const blue = (id: string) => row(id).getByRole('img', { name: '正在执行', exact: true });
    const red = (id: string) => row(id).getByRole('img', { name: '已结束，未查看', exact: true });
    await page.getByRole('button', { name: '展开 重做远端工作台 的子会话', exact: true }).click();
    await expect(blue('child-state')).toBeVisible();
    await expect(red('session-2')).toBeVisible();
    await page.screenshot({ path: 'test-results/session-status-dots.png' });
    fixture.finishWork('child-state');
    await expect(blue('child-state')).toHaveCount(0);
    await expect(red('child-state')).toBeVisible();
    // Returning to connection management unmounts the workspace. The server's
    // unread catalog, rather than an in-memory client flag, restores both dots.
    await page.locator('.server-switch').click();
    await page.getByRole('button', { name: '返回工作台', exact: true }).last().click();
    await page.getByRole('button', { name: '展开 重做远端工作台 的子会话', exact: true }).click();
    await expect(red('child-state')).toBeVisible();
    await expect(red('session-2')).toBeVisible();
    fixture.snapshotDelay.set('session-2', 600);
    await pick('session-2');
    await expect(page.locator('.transcript-loading')).toBeVisible();
    expect(fixture.calls.filter((call) => call.path.endsWith('session-2/unread/acknowledge'))).toHaveLength(0);
    await expect(red('session-2')).toBeVisible();
    await expect(page.getByTestId('message-assistant').first()).toContainText('主机指纹确认');
    await expect(red('session-2')).toHaveCount(0);
    await expect(red('child-state')).toBeVisible();
    fixture.ackDelay.set('child-state', 800);
    await pick('child-state');
    await expect(page.getByTestId('message-assistant').first()).toContainText('子代理任务的执行结果');
    await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('child-state/unread/acknowledge')).length).toBe(1);
    await pick('session-1');
    fixture.finishWork('child-state');
    const newestOrder = fixture.unread.sessions.find((item) => item.sessionId === 'child-state')!.completionOrder;
    await expect(red('child-state')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(red('child-state')).toBeVisible();
    expect(fixture.unread.sessions.find((item) => item.sessionId === 'child-state')?.completionOrder).toBe(newestOrder);
    await pick('child-state');
    await expect(red('child-state')).toHaveCount(0);
    await pick('session-1');
    fixture.startWork('child-state');
    await expect(blue('child-state')).toBeVisible();
    // A task ending during a global-socket gap is recovered from fresh catalogs.
    fixture.closeCatalog(); fixture.finishWork('child-state');
    await expect(red('child-state')).toBeVisible({ timeout: 10000 });
    await expect(blue('child-state')).toHaveCount(0);
    // A healthy socket can still miss a publication. A bounded catalog refresh
    // must recover without a click, session selection, or socket reconnection.
    fixture.startWork('child-state');
    await expect(blue('child-state')).toBeVisible();
    fixture.pauseCatalog(true);
    fixture.finishWork('child-state');
    await expect(blue('child-state')).toHaveCount(0, { timeout: 8000 });
    await expect(red('child-state')).toBeVisible();
    fixture.pauseCatalog(false);
    fixture.startWork('child-state');
    await expect(blue('child-state')).toBeVisible();
    fixture.pauseCatalog(true); fixture.finishWork('child-state');
    const readsBeforeFocus = fixture.calls.filter((call) => call.path.endsWith('/status')).length;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('/status')).length, { timeout: 1500 }).toBeGreaterThan(readsBeforeFocus);
    await expect(blue('child-state')).toHaveCount(0);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('refresh remote environment authenticates inside app, blocks sends, restores draft and rejects active tasks', async () => {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-environment-'));
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
    const password = async () => {
      await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
      await page.getByRole('button', { name: '继续连接', exact: true }).click();
    };
    await password();
    await expect(page.getByTestId('message-assistant').first()).toContainText('项目侧栏');
    await page.getByLabel('发送消息', { exact: true }).fill('刷新后保留的草稿');
    const snapshots = () => fixture.calls.filter((call) => call.path.endsWith('session-1/transcript-snapshot')).length;
    const before = snapshots();
    await page.getByRole('button', { name: '刷新远端环境', exact: true }).click();
    await expect(page.getByRole('button', { name: '刷新远端环境', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await expect(page.getByRole('navigation', { name: '项目与对话' })).toBeVisible();
    await password();
    await expect(page.locator('.environment-notice')).toContainText('服务健康检查通过');
    await expect.poll(snapshots).toBeGreaterThan(before);
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('刷新后保留的草稿');
    await expect(page.getByTestId('message-assistant').first()).toContainText('项目侧栏');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    expect(fixture.environmentRuns).toBe(1);
    await page.screenshot({ path: 'test-results/environment-refreshed.png' });

    fixture.startWork('session-2');
    await page.getByRole('button', { name: '刷新远端环境', exact: true }).click();
    await password();
    await expect(page.getByRole('alert')).toContainText('有对话或子任务正在执行');
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('刷新后保留的草稿');
    fixture.finishWork('session-2');

    fixture.failEnvironmentRefresh(true);
    await page.getByRole('button', { name: '刷新远端环境', exact: true }).click();
    await password();
    await expect(page.getByRole('alert')).toContainText('已恢复之前的代理配置和服务');
    await expect(page.getByRole('button', { name: '刷新远端环境', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await expect(page.getByLabel('发送消息', { exact: true })).toHaveValue('刷新后保留的草稿');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
  } finally { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

async function openComposerFixture() {
  const fixture = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-composer-'));
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ profiles: [{ id: 'fixture', name: 'Composer fixture', host: '127.0.0.1', username: 'test', port: fixture.sshPort, remotePort: fixture.webPort, identityFile: '' }], theme: 'light' }));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await page.getByRole('button', { name: '信任并连接' }).click();
    await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '继续连接', exact: true }).click();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
    return { fixture, desktop, page, async close() { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

test('native composer completes remote skills/files, executes templates and handles command dialogs, forks and tree navigation', async () => {
  const { fixture, page, close } = await openComposerFixture();
  const input = page.getByLabel('发送消息', { exact: true });
  const send = async (text: string) => { await input.fill(text); await page.getByRole('button', { name: '发送', exact: true }).click(); };
  try {
    await input.fill('/skill:rev');
    await expect(page.getByRole('option', { name: /\/skill:review/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/composer-skills.png' });
    await input.press('Enter');
    await expect(input).toHaveValue('/skill:review ');
    expect(fixture.calls.filter((call) => call.path.endsWith('/commands/run') || call.path.endsWith('/prompt'))).toHaveLength(0);
    await input.pressSequentially('inspect @docs/my');
    await page.getByRole('option', { name: /docs\/my file.md/ }).click();
    await expect(input).toHaveValue('/skill:review inspect @"docs/my file.md" ');
    await input.press('Enter');
    await expect(page.getByTestId('message-user').last()).toContainText('Expanded remote review skill');
    expect(fixture.calls.findLast((call) => call.path.endsWith('/commands/run'))?.body.text).toBe('/skill:review inspect @"docs/my file.md"');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);

    await input.fill('/review-');
    await expect(page.getByRole('option', { name: /\/review-pr/ })).toContainText('<PR URL>');
    await input.press('Tab');
    await expect(input).toHaveValue('/review-pr ');
    await input.pressSequentially('https://example.com/pull/1');
    await input.press('Enter');
    await expect(page.getByTestId('message-user').last()).toContainText('Expanded review template');
    await send('/session');
    await expect(page.getByRole('status').filter({ hasText: 'Fixture session statistics' })).toBeVisible();
    await send('/does-not-exist');
    await expect(page.getByText('This command is unavailable', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('/does-not-exist');

    await send('/extension-check');
    await page.getByLabel('Extension input', { exact: true }).fill('Extension answer');
    await page.locator('.extension-prompt').getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByLabel('Extension input', { exact: true })).toHaveCount(0);
    expect(fixture.calls.findLast((call) => call.path.endsWith('/dialogs/answer'))?.body.value).toBe('Extension answer');
    await send('/model');
    await page.getByRole('dialog', { name: '选择模型', exact: true }).getByLabel('选择模型', { exact: true }).selectOption({ label: 'Second model · fixture' });
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await expect.poll(() => fixture.calls.some((call) => call.path.endsWith('/model') && call.body.modelId === 'second-model')).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await send('/fork');
    await page.getByRole('dialog').getByLabel('Choose a message to fork', { exact: true }).selectOption('u1');
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await expect(input).toHaveValue('Restored fork draft');
    await expect(page.locator('.conversation-breadcrumb')).toContainText('Forked conversation');
    await send('/tree');
    await page.getByRole('option', { name: /Original request/ }).click();
    await page.getByLabel('上下文摘要方式').selectOption('custom');
    await page.getByLabel('摘要要求', { exact: true }).fill('Keep decisions');
    await page.getByRole('button', { name: '切换到此处', exact: true }).click();
    await expect(input).toHaveValue('Restored tree draft');
    expect(fixture.calls.findLast((call) => call.path.endsWith('/tree/navigate'))?.body.summary).toEqual({ mode: 'custom', instructions: 'Keep decisions' });
    await send('/tree');
    await page.getByRole('option', { name: /Original response/ }).click();
    await page.getByRole('button', { name: '从此处分叉', exact: true }).click();
    await expect(input).toHaveValue('Tree fork draft');
    await send('/clone');
    await expect(page.locator('.conversation-breadcrumb')).toContainText('Cloned conversation');
    await expect(input).toHaveValue('');
    await send('!echo fixture');
    await expect(page.getByTestId('tool-card').last()).toContainText('!echo fixture');
    await send('/resume');
    await page.getByRole('dialog').getByLabel('切换会话', { exact: true }).selectOption({ label: '重做远端工作台 · Remote Pi' });
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.locator('.conversation-breadcrumb')).toContainText('重做远端工作台');
    await send('/new');
    await expect(page.getByRole('dialog', { name: '新建对话' })).toBeVisible();
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await input.fill('#fixture/sec');
    await page.getByRole('option', { name: /#fixture\/second-model/ }).click();
    await expect(input).toHaveValue('#fixture/second-model ');
    await page.screenshot({ path: 'test-results/composer-commands.png' });
  } finally { await close(); }
});

test('completion results stay with the current query/session, all-file scope works and reload discovers skills', async () => {
  const { fixture, page, close } = await openComposerFixture();
  const input = page.getByLabel('发送消息', { exact: true });
  try {
    fixture.completionDelay.set('READ', 650);
    await input.fill('@READ');
    await expect.poll(() => fixture.calls.some((call) => call.path.endsWith('/files') && call.query.q === 'READ')).toBe(true);
    await input.fill('@docs/');
    await expect(page.getByRole('option', { name: /docs\/my file.md/ })).toBeVisible();
    await page.waitForTimeout(750);
    await expect(page.getByRole('option', { name: /README.md/ })).toHaveCount(0);
    await input.fill('@ local');
    await page.getByRole('option', { name: /local notes.txt/ }).click();
    await expect(input).toHaveValue('@"local notes.txt" ');
    expect(fixture.calls.findLast((call) => call.path.endsWith('/files'))?.query.scope).toBe('all');

    fixture.completionDelay.set('session-1', 650);
    await input.fill('/skill:');
    await expect.poll(() => fixture.calls.some((call) => call.path.endsWith('/session-1/commands'))).toBe(true);
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
    await expect(input).toHaveValue('');
    await input.fill('Another session draft');
    await page.waitForTimeout(750);
    await expect(page.getByRole('listbox', { name: '命令与技能' })).toHaveCount(0);
    await expect(input).toHaveValue('Another session draft');
    await input.dispatchEvent('compositionstart');
    await input.press('Enter');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
    await input.dispatchEvent('compositionend');

    fixture.commands.push({ name: 'skill:newly-installed', source: 'skill', description: 'New remote skill' });
    await input.fill('/reload');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Resources reloaded' })).toBeVisible();
    await input.fill('/skill:new');
    await expect(page.getByRole('option', { name: /\/skill:newly-installed/ })).toBeVisible();
    await input.press('Escape');
    await expect(page.getByRole('listbox', { name: '命令与技能' })).toHaveCount(0);
    await expect(input).toHaveValue('/skill:new');
  } finally { await close(); }
});


test('file picker completes the literal directory before cached copies and only lists its direct children', async () => {
  const { fixture, page, close } = await openComposerFixture();
  const input = page.getByLabel('发送消息', { exact: true });
  const options = page.getByRole('listbox', { name: '远端文件', exact: true }).getByRole('option');
  try {
    await input.fill('@repos/jbsdiff');
    await expect(options.first()).toContainText('repos/jbsdiff/');
    await expect(options.first()).toContainText('目录');
    await expect(options.filter({ hasText: '.cache/' })).toHaveCount(0);
    await expect(page.locator('.completion-heading')).toContainText('远端文件与目录');
    await page.screenshot({ path: 'test-results/literal-directory-completion.png' });
    await input.press('Tab');
    await expect(input).toHaveValue('@repos/jbsdiff/');
    await expect(options).toHaveCount(2);
    await expect(options.first()).toContainText('repos/jbsdiff/src/');
    await expect(options.last()).toContainText('repos/jbsdiff/pom.xml');
    expect(fixture.calls.filter((call) => call.path.endsWith('/files') && call.query.q.startsWith('repos/')).every((call) => call.query.mode === 'path')).toBe(true);
    await input.fill('@repos/missing/');
    await expect(page.getByRole('status').filter({ hasText: '没有匹配结果' })).toBeVisible();
    await expect(options).toHaveCount(0);
    await input.fill('@file.md');
    await options.filter({ hasText: 'docs/my file.md' }).click();
    await expect(input).toHaveValue('@"docs/my file.md" ');
  } finally { await close(); }
});

test('responsive windows keep chat, panels and connection settings reachable on portrait displays', async () => {
  const { fixture, desktop, page, close } = await openComposerFixture();
  const resize = async (width: number, height: number) => {
    await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width);
  };
  const fits = async (selector: string) => {
    await expect.poll(() => page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
  };
  try {
    await page.getByLabel('收起侧栏', { exact: true }).click();
    for (const [width, height] of [[1080, 1500], [768, 1024], [520, 700], [520, 480]]) {
      await resize(width!, height!);
      await fits('.pi-workspace');
      await fits('.conversation-main');
      await fits('.composer-toolbar');
      await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
      await page.getByLabel('文件面板', { exact: true }).click();
      await expect(page.getByRole('complementary', { name: '工作区面板' })).toBeVisible();
      await fits('.inspector');
      if (width! <= 1200) {
        expect(await page.locator('.inspector').evaluate((element) => element.getBoundingClientRect().top >= document.querySelector('.conversation-main')!.getBoundingClientRect().bottom - 1)).toBe(true);
      }
      await page.getByRole('button', { name: 'README.md', exact: true }).click();
      await expect(page.locator('.file-preview')).toContainText('A native desktop workspace.');
      await expect(page.getByLabel('关闭面板', { exact: true })).toBeInViewport();
      await page.getByLabel('关闭面板', { exact: true }).click();
      await expect(page.locator('.inspector')).toHaveCount(0);
    }
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await page.getByLabel('添加项目', { exact: true }).click();
    await page.getByLabel('远端目录', { exact: true }).fill('/srv/projects/portrait');
    await page.getByRole('button', { name: '添加并新建对话', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '添加并新建对话', exact: true })).toBeInViewport();
    await fits('.workspace-dialog');
    await page.getByLabel('关闭对话框', { exact: true }).click();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await resize(1320, 860);
    await page.getByLabel('文件面板', { exact: true }).click();
    expect(await page.locator('.inspector').evaluate((element) => element.getBoundingClientRect().left >= document.querySelector('.conversation-main')!.getBoundingClientRect().right - 1)).toBe(true);
    await page.getByLabel('关闭面板', { exact: true }).click();
    await resize(520, 900);
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await expect(page.getByRole('navigation', { name: '项目与对话' })).toBeVisible();
    await page.getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
    await expect(page.getByRole('navigation', { name: '项目与对话' })).toBeVisible();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(page.getByTestId('message-assistant').first()).toContainText('主机指纹确认');
    fixture.startWork('session-2');
    await expect(page.getByLabel('停止任务', { exact: true })).toBeVisible();
    await fits('.composer-toolbar');
    await expect(page.getByLabel('停止任务', { exact: true })).toBeInViewport();
    await page.getByLabel('发送消息', { exact: true }).fill('竖屏草稿\n'.repeat(40));
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'test-results/workspace-portrait.png' });
    await page.getByLabel('变更面板', { exact: true }).click();
    await expect(page.locator('.diff-content')).toContainText('+<Workspace />');
    await fits('.inspector');
    await page.getByLabel('终端面板', { exact: true }).click();
    await expect(page.locator('.terminal-pane')).toContainText('remote@test:');
    await fits('.inspector');
    await page.getByLabel('关闭面板', { exact: true }).click();
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await page.getByRole('button', { name: 'Composer fixture', exact: false }).click();
    await expect(page.getByRole('heading', { name: /你的远端工作台/ })).toBeVisible();
    await fits('.connection-card');
    await fits('.app-shell');
    await page.getByText('端口与私钥设置', { exact: false }).click();
    await page.getByRole('button', { name: /^(保存配置|已保存)$/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: /^(保存配置|已保存)$/ })).toBeInViewport();
    await page.screenshot({ path: 'test-results/connection-portrait.png' });
  } finally { await close(); }
});

test('up/down recall session inputs, restore drafts and leave completion and multiline navigation intact', async () => {
  const { fixture, page, close } = await openComposerFixture();
  const input = page.getByLabel('发送消息', { exact: true });
  const send = async (text: string) => {
    await input.fill(text);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(page.getByLabel('模型', { exact: true })).toBeEnabled();
  };
  try {
    const initial = await page.getByTestId('message-user').first().innerText();
    await input.focus();
    await input.press('ArrowUp');
    await expect(input).toHaveValue(initial);
    await input.press('ArrowUp');
    await expect(input).toHaveValue(initial);
    await input.press('ArrowDown');
    await expect(input).toHaveValue('');
    await send('历史输入一');
    await send('历史输入二');
    await input.fill('未发送草稿');
    const requests = fixture.calls.filter((call) => call.path.endsWith('/prompt')).length;
    await input.press('ArrowUp');
    await expect(input).toHaveValue('历史输入二');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('历史输入一');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('历史输入二');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('未发送草稿');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(requests);
    await input.press('ArrowUp');
    await input.press('End');
    await input.pressSequentially('，修改后');
    await input.press('ArrowUp');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('历史输入二，修改后');
    await input.fill('第一行\n第二行\n第三行');
    await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 5));
    await input.press('ArrowUp');
    await expect(input).toHaveValue('第一行\n第二行\n第三行');
    await input.press('Control+Home');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('历史输入二');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('第一行\n第二行\n第三行');
    await input.fill('/skill:rev');
    await expect(page.getByRole('option', { name: /\/skill:review/ })).toBeVisible();
    await input.press('ArrowUp');
    await expect(input).toHaveValue('/skill:rev');
    await input.press('Escape');
    await input.fill('选中文字');
    await input.selectText();
    await input.press('ArrowUp');
    await expect(input).toHaveValue('选中文字');
    await input.dispatchEvent('compositionstart');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('选中文字');
    await input.dispatchEvent('compositionend');
    await send('/session');
    await input.fill('/does-not-exist');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('This command is unavailable', { exact: true })).toBeVisible();
    await input.fill('');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('/session');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await input.press('ArrowDown');
    await expect(input).toHaveValue('');
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
    await expect(input).toBeEnabled();
    await input.focus();
    await input.press('ArrowUp');
    await expect(input).toHaveValue('检查服务器连接');
    await input.press('ArrowDown');
    await input.fill('另一个会话的草稿');
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /重做远端工作台/ }).click();
    await expect(input).toBeEnabled();
    await input.focus();
    await input.press('ArrowUp');
    await expect(input).toHaveValue('/session');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('');
  } finally { await close(); }
});

test('sidebar opens at the left edge and always reveals only the active conversation branch', async () => {
  const { fixture, desktop, page, close } = await openComposerFixture();
  const nav = page.getByRole('navigation', { name: '项目与对话' });
  const active = nav.locator('.conversation-row[aria-current="page"]');
  const visibleInsideNav = async () => {
    await expect.poll(() => active.evaluate((element) => {
      const row = element.getBoundingClientRect(); const list = element.closest('nav')!.getBoundingClientRect();
      return row.top >= list.top && row.bottom <= list.bottom;
    })).toBe(true);
  };
  try {
    const parent = fixture.sessions[0]!;
    for (let index = 0; index < 60; index++) fixture.sessions.push({ ...parent, id: `newer-${index}`, path: `/sessions/newer-${index}.jsonl`, name: `较新的对话 ${index}`, modified: '2099-01-01T00:00:00.000Z' });
    fixture.sessions.push(
      { ...parent, id: 'reveal-child', path: '/sessions/reveal-child.jsonl', name: '定位父级子会话', parentSessionPath: parent.path, agentSubsession: true },
      { ...parent, id: 'reveal-target', path: '/sessions/reveal-target.jsonl', name: '定位目标子会话', parentSessionPath: '/sessions/reveal-child.jsonl', agentSubsession: true },
      { ...parent, id: 'reveal-descendant', path: '/sessions/reveal-descendant.jsonl', name: '目标下的默认折叠子会话', parentSessionPath: '/sessions/reveal-target.jsonl', agentSubsession: true },
    );
    await page.getByLabel('刷新项目', { exact: true }).click();
    await expect(nav.getByRole('button', { name: /较新的对话 59/ })).toHaveCount(1);
    await nav.evaluate((element) => { element.scrollTop = 0; });
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await visibleInsideNav();
    expect(await nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('li[data-session-id="reveal-child"]')).toHaveCount(0);
    // Live status refreshes must not pull the sidebar back after manual scrolling.
    await nav.evaluate((element) => { element.scrollTop = 0; });
    fixture.startWork('session-2');
    await expect(page.locator('li[data-session-id="session-2"] .session-status-dot.running')).toHaveCount(1);
    expect(await nav.evaluate((element) => element.scrollTop)).toBe(0);
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(page.locator('.project-sidebar')).toHaveCount(0);
    await page.mouse.move(2, 200);
    await page.mouse.move(100, 200);
    await page.waitForTimeout(250); // Crossing the edge briefly must not open it later.
    await expect(nav).toHaveCount(0);
    await page.mouse.move(2, 200);
    await expect(nav).toBeVisible();
    await visibleInsideNav();
    await page.mouse.move(500, 200);
    await expect(nav).toHaveCount(0);
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await page.mouse.move(500, 200);
    await expect(nav).toBeVisible();
    await visibleInsideNav();
    await page.getByLabel('搜索项目和对话').fill('定位目标子会话');
    await page.locator('li[data-session-id="reveal-target"] > .conversation-tree-row > .conversation-row').click();
    await page.getByLabel('清除搜索', { exact: true }).click();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await visibleInsideNav();
    await expect(active).toContainText('定位目标子会话');
    await expect(page.getByRole('button', { name: '收起 重做远端工作台 的子会话', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '收起 定位父级子会话 的子会话', exact: true })).toBeVisible();
    await expect(page.locator('li[data-session-id="reveal-descendant"]')).toHaveCount(0);
    await nav.getByRole('button', { name: 'Remote Pi', exact: true }).click();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await visibleInsideNav();
    await page.getByLabel('搜索项目和对话').fill('不匹配任何对话');
    await page.getByLabel('切换归档对话', { exact: true }).click();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await expect(page.getByLabel('搜索项目和对话')).toHaveValue('');
    await visibleInsideNav();
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 800));
    await expect(nav).toBeVisible();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(nav).toHaveCount(0);
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await visibleInsideNav();
    await active.click();
    await expect(nav).toBeVisible();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(nav).toHaveCount(0);
    await expect(page.locator('.project-sidebar')).toHaveCount(0);
    await page.mouse.move(2, 200);
    await expect(nav).toBeVisible();
    await visibleInsideNav();
    await page.mouse.move(450, 200);
    await expect(nav).toHaveCount(0);
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await page.mouse.move(450, 200);
    await expect(nav).toBeVisible();
    await visibleInsideNav();
  } finally { await close(); }
});

test('hover sidebar slides over a stationary chat with fading glass and keeps its exit animation mounted', async () => {
  const { page, close } = await openComposerFixture();
  const nav = page.getByRole('navigation', { name: '项目与对话' });
  const surface = page.locator('.sidebar-preview .sidebar-surface');
  const scrim = page.locator('.sidebar-preview .sidebar-scrim');
  try {
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(page.locator('.project-sidebar')).toHaveCount(0);
    const chat = await page.locator('.conversation-main').boundingBox();
    await page.mouse.move(2, 200);
    await expect(page.locator('.pi-workspace')).toHaveClass(/sidebar-preview/);
    await expect.poll(() => surface.evaluate((element) => element.getAnimations().some((animation) => animation.playState === 'running'))).toBe(true);
    expect(await page.locator('.conversation-main').boundingBox()).toEqual(chat);
    await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await expect.poll(() => scrim.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    expect(await surface.evaluate((element) => getComputedStyle(element).backdropFilter)).toContain('blur');
    await expect(nav).toBeVisible();
    await page.screenshot({ path: 'test-results/sidebar-glass-light.png' });
    await page.getByLabel('切换主题', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const selectedBackground = await page.locator('.conversation-row.selected').evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.cssText = 'display:none;background:var(--selected)';
      element.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    await expect.poll(() => page.locator('.conversation-row.selected').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(selectedBackground);
    await page.screenshot({ path: 'test-results/sidebar-glass-dark.png' });
    await page.mouse.move(700, 200);
    await expect(nav).toHaveCount(0);
    await expect(surface).toHaveCount(1);
    await expect.poll(() => surface.evaluate((element) => element.getAnimations().some((animation) => animation.playState === 'running'))).toBe(true);
    expect(await page.locator('.conversation-main').boundingBox()).toEqual(chat);
    // Re-entering during the exit reverses the transition instead of removing it.
    await page.mouse.move(2, 200);
    await expect(nav).toBeVisible();
    await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await page.mouse.move(700, 200);
    await expect(surface).toHaveCount(0);
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await page.mouse.move(700, 200);
    await expect(nav).toBeVisible();
    await expect(page.locator('.pi-workspace')).not.toHaveClass(/sidebar-preview/);
    await expect(page.locator('.sidebar-scrim')).toHaveCount(0);
    await expect.poll(() => page.locator('.conversation-main').evaluate((element) => element.getBoundingClientRect().left)).toBe(258);
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEditable();
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(nav).toHaveCount(0);
    await expect(page.locator('.project-sidebar')).toHaveCount(1);
    await expect(page.locator('.project-sidebar')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(2, 200);
    await expect(nav).toBeVisible();
    expect(await surface.evaluate((element) => getComputedStyle(element).transitionDuration.split(',').every((value) => parseFloat(value) <= 0.001))).toBe(true);
  } finally { await close(); }
});

test('workspace panels coexist with chat and allow both terminal input and agent drafts', async () => {
  const { fixture, desktop, page, close } = await openComposerFixture();
  const panel = page.locator('.inspector');
  const input = page.getByLabel('发送消息', { exact: true });
  const settled = async () => {
    await expect.poll(() => panel.evaluate((element) => element.getAnimations().every((animation) => animation.playState !== 'running')
      && getComputedStyle(element.querySelector('.inspector-surface')!).transform === 'matrix(1, 0, 0, 1, 0, 0)')).toBe(true);
  };
  try {
    const chat = (await page.locator('.conversation-main').boundingBox())!;
    await page.getByLabel('文件面板', { exact: true }).click();
    await expect.poll(() => panel.evaluate((element) => element.getAnimations().some((animation) => animation.playState === 'running'))).toBe(true);
    await settled();
    const adjacent = (await page.locator('.conversation-main').boundingBox())!;
    expect(adjacent.width).toBeLessThan(chat.width);
    expect(await panel.evaluate((element) => element.getBoundingClientRect().left >= document.querySelector('.conversation-main')!.getBoundingClientRect().right - 1)).toBe(true);
    await expect(page.locator('.panel-scrim')).toHaveCount(0);
    expect(await page.locator('.conversation-main').evaluate((element) => getComputedStyle(element).filter)).toBe('none');
    expect(await page.locator('.conversation-main').evaluate((element) => getComputedStyle(element).backdropFilter)).toBe('none');
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(page.locator('.file-preview')).toContainText('A native desktop workspace.');
    await input.fill('文件面板打开时编辑消息');
    await expect(input).toHaveValue('文件面板打开时编辑消息');
    await page.getByLabel('变更面板', { exact: true }).click();
    await expect(page.locator('.diff-content')).toContainText('+<Workspace />');
    await page.getByLabel('终端面板', { exact: true }).click();
    await expect(page.locator('.terminal-pane')).toContainText('remote@test:');
    await settled();
    const terminalInput = page.locator('.terminal-pane .xterm-helper-textarea');
    await terminalInput.focus();
    await page.keyboard.type('terminal-and-agent');
    await expect(page.locator('.terminal-pane')).toContainText('terminal-and-agent');
    await input.fill('终端打开时也能编辑 Agent 消息');
    await terminalInput.focus();
    await page.keyboard.type('-still-connected');
    await expect(page.locator('.terminal-pane')).toContainText('-still-connected');
    await expect(input).toHaveValue('终端打开时也能编辑 Agent 消息');
    expect(fixture.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(0);
    await page.screenshot({ path: 'test-results/workspace-panel-docked.png' });
    await page.getByLabel('关闭面板', { exact: true }).click();
    await expect(page.getByRole('complementary', { name: '工作区面板' })).toHaveCount(0);
    await expect(panel).toHaveCount(1);
    await page.getByLabel('终端面板', { exact: true }).click();
    await expect(page.getByRole('complementary', { name: '工作区面板' })).toBeVisible();
    await settled();
    const terminalCreates = fixture.calls.filter((call) => call.path.endsWith('/terminal.create')).length;
    await page.getByLabel('关闭面板', { exact: true }).click();
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /首页布局探索/ }).click();
    await expect(page.locator('.conversation-intro')).toContainText('首页布局探索');
    await expect(panel).toHaveCount(0);
    expect(fixture.calls.filter((call) => call.path.endsWith('/terminal.create'))).toHaveLength(terminalCreates);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 800));
    await page.getByLabel('终端面板', { exact: true }).click();
    await settled();
    expect(await panel.evaluate((element) => element.getBoundingClientRect().top >= document.querySelector('.conversation-main')!.getBoundingClientRect().bottom - 1)).toBe(true);
    await expect(input).toBeInViewport();
    await input.fill('竖屏中同时保留聊天与终端');
    await page.locator('.terminal-pane .xterm-helper-textarea').focus();
    await page.keyboard.type('narrow-terminal');
    await expect(page.locator('.terminal-pane')).toContainText('narrow-terminal');
    await expect(input).toHaveValue('竖屏中同时保留聊天与终端');
    await page.getByLabel('关闭面板', { exact: true }).click();
    await expect(panel).toHaveCount(0);
  } finally { await close(); }
});

test('sidebar toggle prioritizes unread completion dots and clears them only through conversation acknowledgements', async () => {
  const { fixture, page, close } = await openComposerFixture();
  const toggle = () => page.getByLabel('展开侧栏', { exact: true });
  const red = () => toggle().getByRole('img', { name: '有已完成未读对话', exact: true });
  const blue = () => toggle().getByRole('img', { name: '有对话正在执行', exact: true });
  const collapse = async () => { await page.getByLabel('收起侧栏', { exact: true }).click(); };
  try {
    await collapse();
    await expect(red()).toHaveCount(0);
    await expect(blue()).toHaveCount(0);
    fixture.startWork('session-3');
    await expect(blue()).toBeVisible();
    fixture.finishWork('session-2');
    await expect(red()).toBeVisible();
    await expect(blue()).toHaveCount(0);
    await toggle().click();
    await expect(page.locator('li[data-session-id="session-2"] .session-status-dot.unread')).toBeVisible();
    await collapse();
    await expect(red()).toBeVisible();
    await toggle().click();
    fixture.ackDelay.set('session-2', 500);
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
    await expect(page.getByLabel('收起侧栏', { exact: true }).getByRole('img', { name: '有已完成未读对话' })).toBeVisible();
    await expect(page.locator('li[data-session-id="session-2"] .session-status-dot.unread')).toHaveCount(0);
    await collapse();
    await expect(red()).toHaveCount(0);
    await expect(blue()).toBeVisible();
    fixture.finishWork('session-3');
    await expect(red()).toBeVisible();
    await expect(blue()).toHaveCount(0);
    await toggle().click();
    await page.getByRole('navigation', { name: '项目与对话' }).getByRole('button', { name: /首页布局探索/ }).click();
    await expect(page.locator('li[data-session-id="session-3"] .session-status-dot.unread')).toHaveCount(0);
    await collapse();
    await expect(red()).toHaveCount(0);
    await expect(blue()).toHaveCount(0);
  } finally { await close(); }
});


test('clicked sidebar docks beside chat and stays open across selections on narrow screens', async () => {
  const { desktop, page, close } = await openComposerFixture();
  const nav = page.getByRole('navigation', { name: '项目与对话' });
  try {
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(page.locator('.project-sidebar')).toHaveCount(0);
    for (const width of [1320, 780, 520]) {
      await desktop.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 800), width);
      await page.getByLabel('展开侧栏', { exact: true }).click();
      await page.mouse.move(width - 20, 200);
      await expect(nav).toBeVisible();
      await expect(page.locator('.sidebar-scrim')).toHaveCount(0);
      await expect.poll(() => page.locator('.project-sidebar').evaluate((element) => element.getAnimations().every((animation) => animation.playState !== 'running'))).toBe(true);
      expect(await page.locator('.project-sidebar').evaluate((element) => element.getBoundingClientRect().right <= document.querySelector('.conversation-main')!.getBoundingClientRect().left + 1)).toBe(true);
      await nav.getByRole('button', { name: /梳理 SSH 连接流程/ }).click();
      await expect(nav).toBeVisible();
      await page.getByLabel('发送消息', { exact: true }).fill('侧栏常驻时编辑草稿');
      await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
      await expect(page.getByLabel('文件面板', { exact: true })).toBeInViewport();
      await page.getByLabel('文件面板', { exact: true }).click();
      await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
      expect(await page.locator('.inspector').evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
      await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
      await page.screenshot({ path: `test-results/sidebar-docked-${width}.png` });
      await page.getByLabel('关闭面板', { exact: true }).click();
      await page.getByLabel('收起侧栏', { exact: true }).click();
      await expect(page.locator('.project-sidebar')).toHaveCount(0);
    }
  } finally { await close(); }
});
