import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';
import type { WireMessage } from '../../src/shared/pi';

const messages: WireMessage[] = [
  { entryId: 'visual-user', role: 'user', content: '让阅读和写代码都更舒服：保留清晰的层次，竖屏时也能一边查看结果，一边继续输入。' },
  { entryId: 'visual-answer', role: 'assistant', model: 'test-model', content: [{ type: 'text', text: `## 一个更安静的工作空间

这次调整关注 **阅读、边界与节奏**。中文和 English 可以自然地出现在同一段里，长回复也应保持舒适的行距。你可以通过 \`@src/renderer\` 引用文件，或使用 /skill:review 继续检查代码。

### 阅读与操作

- 对话保持主角，项目导航和工作区提供必要的上下文。
- 文件、Git 与终端和输入框并存，草稿始终可编辑。

| 区域 / Area | 使用方式 | 状态 |
| --- | --- | --- |
| 对话 Conversation | 阅读回复与工具结果 | 就绪 |
| 工作区 Workspace | 文件、变更与终端 | 可用 |

\`\`\`typescript
const workspace = { title: 'Remote Pi', description: '${'Readable code and 清晰的中文边界 / '.repeat(8)}' };
function openWorkspace() {
  return workspace.title;
}
\`\`\`

> 调整窗口宽度之后，正文应自然换行；较长代码保留自己的横向滚动区域。

下面是本次检查的工具结果。展开后可以查看参数与输出，再继续输入下一步需求。` }, { type: 'toolCall', id: 'visual-read', name: 'read', arguments: { path: 'src/renderer/workspace/Workspace.tsx' } }] },
  { entryId: 'visual-tool', role: 'toolResult', toolCallId: 'visual-read', toolName: 'read', content: 'export function Workspace() {\n  return <Conversation />;\n}\n\nRead 142 lines.', isError: false },
];

async function openFixture() {
  const fixture = await startFixture();
  fixture.histories.set('session-1', messages);
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-visual-polish-'));
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ profiles: [{ id: 'fixture', name: 'Visual fixture', host: '127.0.0.1', username: 'test', port: fixture.sshPort, remotePort: fixture.webPort, identityFile: '' }], theme: 'light' }));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), REMOTE_PI_TEST_MODE: '1', REMOTE_PI_USER_DATA: dir, REMOTE_PI_TEST_KNOWN_HOSTS: join(dir, 'known_hosts') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ args: ['.'], env });
  try {
    const page = await desktop.firstWindow();
    await page.getByRole('button', { name: '连接工作台', exact: true }).click();
    await page.getByRole('button', { name: '信任并连接', exact: true }).click();
    await page.getByLabel('SSH 验证响应').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '继续连接', exact: true }).click();
    await expect(page.getByLabel('发送消息', { exact: true })).toBeEditable();
    await expect(page.locator('.stream-notice')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '一个更安静的工作空间' })).toBeAttached();
    return { desktop, page, async close() { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await desktop.close(); await fixture.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

test('polished themes keep rich replies and drafts usable on desktop and portrait with reduced motion', async ({}, testInfo) => {
  const { desktop, page, close } = await openFixture();
  const input = page.getByLabel('发送消息', { exact: true });
  const draft = '继续检查阅读体验，保留我的这段草稿。\nKeep the conversation in focus.';
  const capture = async (name: string) => {
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(input).toBeEditable();
    await expect(input).toHaveValue(draft);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };
  try {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 1000));
    await input.fill(draft);
    await page.locator('.transcript-scroll').evaluate((node) => { node.scrollTop = 0; });
    await capture('desktop-light');
    await page.getByLabel('切换主题', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await capture('desktop-dark');

    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(page.locator('.project-sidebar')).toHaveCount(0);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(600, 1000));
    await page.getByTestId('tool-card').locator('summary').click();
    await expect(page.getByTestId('tool-card')).toContainText('Read 142 lines.');
    await expect.poll(() => page.locator('.code-block pre').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect.poll(() => page.locator('.transcript-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await capture('portrait-dark');
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await page.getByLabel('切换主题', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('收起侧栏', { exact: true }).click();
    await expect(page.locator('.project-sidebar')).toHaveCount(0);
    await capture('portrait-light');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByLabel('展开侧栏', { exact: true }).click();
    await expect(page.getByRole('navigation', { name: '项目与对话' })).toBeVisible();
    expect(await page.locator('.pi-workspace, .sidebar-surface, .composer').evaluateAll((nodes) => nodes.every((node) => {
      const style = getComputedStyle(node);
      return [style.transitionDuration, style.animationDuration].every((durations) => durations.split(',').every((duration) => parseFloat(duration) <= 0.05));
    }))).toBe(true);
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(input).toHaveValue(draft);
  } finally { await close(); }
});
