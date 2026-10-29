import { test, expect, type Page, type TestInfo } from '@playwright/test';

async function fixture(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(({ theme }) => {
    const w = window as any;
    const listeners: Record<string, Set<(value: any) => void>> = {};
    const on = (name: string, callback: (value: any) => void) => { (listeners[name] ||= new Set()).add(callback); return () => listeners[name].delete(callback); };
    const emit = (name: string, value: any) => { for (const listener of listeners[name] || []) listener(value); };
    const profile = { id: 'test-server', name: '开发服务器', host: '192.0.2.10', username: 'developer', port: 22, remotePort: 8504, identityFile: '' };
    const connected = { phase: 'connected', profileId: profile.id, message: 'SSH 已连接' };
    let connection: any = sessionStorage.getItem('fixture-connected') ? connected : { phase: 'idle', message: '尚未连接服务器' };
    let resolveConnect: () => void;
    const now = new Date().toISOString();
    const project = { id: 'p1', name: 'Remote Pi', path: '/srv/projects/remote-pi', createdAt: now };
    const workspace = { id: 'w1', projectId: 'p1', path: project.path, label: 'main', isMain: true };
    const sessions = [
      { id: 'main', path: '/sessions/main.jsonl', cwd: project.path, name: '设计手机工作台', firstMessage: '', created: now, modified: now, messageCount: 3 },
      { id: 'child', path: '/sessions/child.jsonl', parentSessionPath: '/sessions/main.jsonl', agentSubsession: true, cwd: project.path, name: '审查 SSH 连接', firstMessage: '', created: now, modified: now, messageCount: 1 },
      { id: 'other', path: '/sessions/other.jsonl', cwd: project.path, name: '准备发布清单', firstMessage: '', created: now, modified: now, messageCount: 1 },
    ];
    let unread: any = { catalogId: 'fixture', catalogRevision: 1, sessions: [{ sessionId: 'other', cwd: project.path, completionOrder: 1, completedAt: now }] };
    let watching: any;
    const status = (id: string) => ({ sessionId: id, model: { provider: 'fixture', id: 'test', name: '测试模型' }, thinkingLevel: 'medium', isStreaming: id === 'child', isCompacting: false, isBashRunning: false, pendingMessageCount: 0 });
    const machine = () => ({ epochId: 'fixture', revision: unread.catalogRevision, sessions: { child: { 'core:working': true } }, machine: {}, unattributed: {} });
    const code = 'const workspace = "' + 'mobile-workspace-'.repeat(18) + '";';
    const answer = '我会保留项目和 Subagent 的层级，让聊天成为主屏。\n\n文件、变更和终端会在需要时全屏打开，输入框始终留在手边。\n\n```ts\n' + code + '\n```';
    const toolOutput = 'Read README.md: Remote Pi Android';
    w.__fixture = { calls: [] as { operation: string; input: any }[], watchCount: 0, refresh: () => emit('refresh', undefined), copied: '', failCopy: false, code, answer, toolOutput };
    // Keep UI copy checks isolated from the user's clipboard.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
      if (w.__fixture.failCopy) throw Error('fixture clipboard denied');
      w.__fixture.copied = text;
    } } });
    w.desktop = {
      getSettings: async () => ({ profiles: [profile], theme }), getConnection: async () => connection,
      saveProfile: async (value: any) => value, deleteProfile: async () => {}, setTheme: async () => {}, pickIdentity: async () => 'key:fixture',
      connect: async () => new Promise<void>((resolve) => {
        resolveConnect = resolve;
        connection = { phase: 'authenticating', profileId: profile.id, message: '请确认主机指纹' };
        emit('connection', connection); emit('challenge', { id: 'host', kind: 'host', prompt: 'SHA256:TEST-FIXTURE-ONLY' });
      }),
      answerChallenge: async (id: string, answer: string | null) => {
        if (answer === null) { emit('challenge', null); connection = { phase: 'idle', message: '已取消' }; emit('connection', connection); resolveConnect(); }
        else if (id === 'host') emit('challenge', { id: 'secret', kind: 'secret', prompt: 'Password for developer:' });
        else { sessionStorage.setItem('fixture-connected', 'true'); emit('challenge', null); connection = connected; emit('connection', connection); resolveConnect(); }
      },
      disconnect: async () => { sessionStorage.removeItem('fixture-connected'); connection = { phase: 'idle', message: '已断开' }; emit('connection', connection); },
      onConnection: (callback: any) => on('connection', callback), onChallenge: (callback: any) => on('challenge', callback), onWorkspace: (callback: any) => on('workspace', callback), onWorkspaceRefresh: (callback: any) => on('refresh', callback),
      piRequest: async (operation: string, input: any) => {
        w.__fixture.calls.push({ operation, input });
        if (operation === 'projects.list') return [project];
        if (operation === 'workspaces.list') return { workspaces: [workspace] };
        if (operation === 'sessions.list') return sessions;
        if (operation === 'machine.status') return machine();
        if (operation === 'sessions.unread') return unread;
        if (operation === 'session.models') return { models: [status('main').model] };
        if (operation === 'session.thinkingLevels') return { levels: ['low', 'medium', 'high'] };
        if (operation === 'session.acknowledgeUnread') { unread = { ...unread, catalogRevision: unread.catalogRevision + 1, sessions: unread.sessions.filter((item: any) => item.sessionId !== input.id) }; return unread; }
        if (operation === 'session.commands') return [
          { name: 'skill:review', source: 'skill', description: '检查改动与测试覆盖', argumentHint: '<任务>' },
          { name: 'model', source: 'builtin', description: '选择模型' },
          { name: 'reload', source: 'builtin', description: '重新加载技能与扩展' },
        ];
        if (operation === 'session.command') return { type: 'done', message: '已调用远端技能' };
        if (operation === 'session.shell') return {};
        if (operation === 'files.suggest') return (input.query === 'src/renderer/' ? ['src/renderer/Workspace.tsx'] : ['src/renderer/']).map((path) => ({ path, kind: 'tracked' }));
        if (operation === 'files.tree') return { path: '', entries: [{ name: 'README.md', path: 'README.md', type: 'file' }], truncated: false };
        if (operation === 'files.read') return { path: 'README.md', content: '# Remote Pi Android\n\n手机端文件预览。', binary: false, truncated: false };
        if (operation === 'git.status') return w.__fixture.gitStatus || { isGitRepo: true, branch: 'main', files: [] };
        if (operation === 'git.diff') return { diff: !input.staged && input.path === 'README.md' ? w.__fixture.untrackedDiff || '' : '' };
        if (operation === 'session.prompt') { emit('workspace', { type: 'event', subscriptionId: watching.sub, session: watching, event: { type: 'message.append', message: { role: 'user', entryId: crypto.randomUUID(), content: input.text } } }); return {}; }
        throw Error('Unexpected test operation ' + operation);
      },
      watchSession: async (session: any, sub: string) => {
        w.__fixture.watchCount++;
        watching = { ...session, sub };
        setTimeout(() => {
          if (watching?.sub !== sub) return;
          const messages = session.id === 'main' ? [
            { role: 'user', entryId: 'u1', content: '把服务器上的工作带到手机上。' },
            { role: 'assistant', entryId: 'a1', content: [{ type: 'text', text: answer }, { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'README.md' } }] },
            { role: 'toolResult', entryId: 't1', toolCallId: 'read-1', toolName: 'read', content: toolOutput, isError: false },
          ] : [{ role: 'assistant', entryId: 'a2', content: session.id === 'child' ? '正在检查 SSH 身份验证与主机指纹。' : '发布清单已经准备好。' }];
          emit('workspace', { type: 'snapshot', subscriptionId: sub, session, snapshot: { seq: 1, partial: null, page: { messages, start: 0, total: messages.length }, status: status(session.id) } });
          emit('workspace', { type: 'stream', subscriptionId: sub, session, state: 'live' });
        }, 20);
      },
      unwatchSession: async () => {}, openLink: async () => {},
      attachTerminal: async (_project: string, _workspace: string, subscriptionId: string) => { emit('terminal', { type: 'ready', subscriptionId }); emit('terminal', { type: 'output', subscriptionId, data: 'developer@server:~/remote-pi$ ' }); },
      terminalInput: () => {}, terminalResize: () => {}, detachTerminal: async () => {}, onTerminal: (callback: any) => on('terminal', callback),
    };
  }, { theme });
  await page.goto('http://127.0.0.1:4179');
}

async function connect(page: Page) {
  await page.getByRole('button', { name: '连接工作台', exact: true }).click();
  await page.getByRole('button', { name: '信任并连接' }).click();
  await page.getByLabel('SSH 验证响应').fill('fixture-password');
  await page.getByRole('button', { name: '继续连接', exact: true }).click();
  await expect(page.getByTestId('message-assistant').first()).toBeVisible();
  await expect(page.locator('.stream-notice')).toHaveCount(0);
}
async function back(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event('remote-pi:back', { cancelable: true }))); }
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await fits(page);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} phone connection, chat, drawer, completions and workspace tools`, async ({ page }, testInfo) => {
    await fixture(page, theme);
    await expect(page.getByRole('button', { name: '连接工作台', exact: true })).toBeVisible();
    await screenshot(page, testInfo, 'connect');
    await connect(page);
    await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport({ ratio: 1 });
    await screenshot(page, testInfo, 'chat');
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    const main = page.locator('li[data-session-id="main"]');
    const child = page.locator('li[data-session-id="child"] > .conversation-tree-row');
    await expect(child).toHaveCount(0);
    await main.getByRole('button', { name: '展开 设计手机工作台 的子会话', exact: true }).click();
    await expect(child.getByRole('img', { name: '正在执行', exact: true })).toBeVisible();
    await expect(page.locator('li[data-session-id="other"]').getByRole('img', { name: '已结束，未查看', exact: true })).toBeVisible();
    await screenshot(page, testInfo, 'drawer');
    await child.locator(':scope > .conversation-row').click();
    await expect(page.locator('.project-sidebar')).not.toBeVisible();
    await expect(page.getByTestId('message-assistant').first()).toContainText('身份验证');
    await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await back(page);
    await expect(page.locator('.project-sidebar')).not.toBeVisible();
    const input = page.getByLabel('发送消息', { exact: true });
    await input.fill('/skill:');
    await expect(page.getByRole('option', { name: /\/skill:review/ })).toBeVisible();
    await screenshot(page, testInfo, 'completions');
    await input.fill('');
    await page.getByRole('button', { name: '文件面板', exact: true }).click();
    await expect(page.getByLabel('工作区面板')).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(page.locator('.file-preview')).toContainText('手机端文件预览');
    await screenshot(page, testInfo, 'files');
    await page.getByRole('button', { name: '切换到变更', exact: true }).click();
    await expect(page.getByText('暂无变更', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '切换到终端', exact: true }).click();
    await expect(page.locator('.xterm-screen')).toBeVisible();
    await expect(page.getByText('正在连接远端终端…', { exact: true })).toHaveCount(0);
    await screenshot(page, testInfo, 'terminal');
    await back(page);
    await expect(page.locator('.inspector')).not.toBeVisible();
    await expect(input).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: 360, height: 430 });
    await input.fill('键盘弹出时继续编辑\n第二行');
    await expect(input).toBeInViewport({ ratio: 1 });
    await screenshot(page, testInfo, 'keyboard-narrow');
  });
}

test('phone Enter keeps a newline, Ctrl+Enter sends, and the composer fits phone widths and a keyboard', async ({ page }, testInfo) => {
  await fixture(page); await connect(page);
  const input = page.getByLabel('发送消息', { exact: true });
  await input.fill('第一行'); await input.press('Enter'); await input.press('a');
  await expect(input).toHaveValue('第一行\na');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await input.press('Control+Enter');
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(input).toHaveValue('');
  await input.fill('点击发送'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByTestId('message-user')).toHaveCount(3);
  for (const width of [360, 393, 430]) {
    await page.setViewportSize({ width, height: 780 });
    await expect(input).toBeInViewport({ ratio: 1 });
    await screenshot(page, testInfo, `chat-${width}`);
    await page.setViewportSize({ width, height: 430 });
    await input.fill('键盘弹出时仍能继续编辑\n第二行\n第三行');
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });
    await screenshot(page, testInfo, `keyboard-${width}`);
  }
});

test('touch completes skills and file directories, drafts survive reload, and model dialogs handle Android Back', async ({ page }) => {
  await fixture(page); await connect(page);
  const input = page.getByLabel('发送消息', { exact: true });
  await input.fill('/skill:');
  await page.getByRole('option', { name: /\/skill:review/ }).tap();
  await expect(input).toHaveValue('/skill:review ');
  await input.press('End'); await input.pressSequentially('检查手机 UI');
  await page.getByRole('button', { name: '发送', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.calls.filter((call: any) => call.operation === 'session.command').map((call: any) => call.input.text))).toEqual(['/skill:review 检查手机 UI']);
  await expect(input).toHaveValue('');
  await input.fill('@src/ren');
  await page.getByRole('option', { name: 'src/renderer/ 目录', exact: true }).tap();
  await expect(input).toHaveValue('@src/renderer/');
  await page.getByRole('option', { name: 'src/renderer/Workspace.tsx 已跟踪', exact: true }).tap();
  await expect(input).toHaveValue('@src/renderer/Workspace.tsx ');
  await expect(page.getByRole('listbox', { name: '远端文件', exact: true })).toHaveCount(0);
  await input.fill('保留这份手机草稿 @src/renderer/Workspace.tsx');
  await page.reload();
  await expect(input).toHaveValue('保留这份手机草稿 @src/renderer/Workspace.tsx');
  await expect(page.locator('.stream-notice')).toHaveCount(0);
  await input.fill('/model'); await input.press('Escape');
  await page.getByRole('button', { name: '发送', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '选择模型', exact: true })).toBeVisible();
  await back(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '对话菜单', exact: true }).click();
  await page.getByRole('button', { name: '重命名对话', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '重命名对话', exact: true })).toBeVisible();
  await back(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(input).toBeInViewport({ ratio: 1 });
});

test('message, code and tool output copy with feedback while long code stays inside a narrow chat', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 }); await fixture(page); await connect(page);
  await page.getByRole('button', { name: '复制回复', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.copied === (window as any).__fixture.answer)).toBe(true);
  await expect(page.getByTestId('message-assistant').locator('.message-actions [role="status"]')).toHaveText('已复制');
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.copied === (window as any).__fixture.code)).toBe(true);
  await page.evaluate(() => { (window as any).__fixture.failCopy = true; });
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  await expect(page.locator('.code-block [role="status"]')).toHaveText('复制失败，请重试');
  await page.evaluate(() => { (window as any).__fixture.failCopy = false; });
  await page.getByTestId('tool-card').locator('summary').click();
  await page.getByRole('button', { name: '复制输出', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.copied === (window as any).__fixture.toolOutput)).toBe(true);
  await expect(page.getByTestId('tool-card').getByRole('status')).toHaveText('已复制');
  expect(await page.locator('.code-block pre').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await fits(page);
});


test('tablet tools coexist with chat, resize and preserve previews on resume; landscape phones return to the composer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 600 }); await fixture(page); await connect(page);
  const input = page.getByLabel('发送消息', { exact: true });
  const inspector = page.getByLabel('工作区面板', { exact: true });
  await page.getByRole('button', { name: '文件面板', exact: true }).click();
  for (const width of [1024, 1366]) {
    await page.setViewportSize({ width, height: 600 });
    await expect(inspector).toBeInViewport({ ratio: 1 });
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.mobile-sidebar-shade')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const chat = document.querySelector('.conversation-main')!.getBoundingClientRect();
      const tools = document.querySelector('.inspector')!.getBoundingClientRect();
      return window.innerWidth <= 1200 ? chat.bottom <= tools.top + 1 : chat.right <= tools.left + 1;
    })).toBe(true);
    await input.fill(`平板 ${width} 上继续编辑`);
    await expect(input).toBeFocused();
    await page.locator('.file-list').getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(page.locator('.file-preview')).toContainText('手机端文件预览');

    const stacked = width === 1024;
    const handle = page.getByRole('separator', { name: stacked ? '调整面板高度' : '调整右侧栏宽度', exact: true });
    const before = await inspector.boundingBox();
    const grip = await handle.boundingBox();
    expect(before).not.toBeNull(); expect(grip).not.toBeNull();
    const x = grip!.x + grip!.width / 2; const y = grip!.y + grip!.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - (stacked ? 0 : 32), y - (stacked ? 32 : 0), { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => { const after = await inspector.boundingBox(); return stacked ? after!.height - before!.height : after!.width - before!.width; }).toBeGreaterThan(20);
    await expect(input).toBeInViewport({ ratio: 1 });

    await page.locator('.file-preview').evaluate((node) => node.setAttribute('data-resume-preview', 'true'));
    const watchCount = await page.evaluate(() => (window as any).__fixture.watchCount);
    await page.evaluate(() => (window as any).__fixture.refresh());
    await expect.poll(() => page.evaluate(() => (window as any).__fixture.watchCount)).toBeGreaterThan(watchCount);
    await expect(page.locator('.stream-notice')).toHaveCount(0);
    await expect(page.locator('.file-preview')).toHaveAttribute('data-resume-preview', 'true');
    await expect(input).toHaveValue(`平板 ${width} 上继续编辑`);
    await screenshot(page, testInfo, `tablet-${width}`);
    await page.locator('.file-back').click();
  }

  await page.setViewportSize({ width: 740, height: 360 });
  await expect(inspector).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeGreaterThanOrEqual(738);
  await page.locator('.file-list').getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(page.locator('.file-preview')).toBeVisible();
  await screenshot(page, testInfo, 'phone-landscape-tools');
  await back(page);
  await expect(inspector).not.toBeVisible();
  await expect(input).toBeInViewport({ ratio: 1 });
  await input.fill('横屏返回后继续编辑');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });
  await screenshot(page, testInfo, 'phone-landscape-chat');
});


test('Git explains untracked files without mislabeling an empty staged diff', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const state = (window as any).__fixture;
    state.gitStatus = { isGitRepo: true, branch: 'main', files: [{ path: 'README.md', index: 'untracked', workingTree: 'untracked' }] };
    state.untrackedDiff = 'diff --git a/README.md b/README.md\nnew file mode 100644\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+# New project\n';
  });
  await connect(page);
  await page.getByRole('button', { name: '文件面板', exact: true }).click();
  await page.getByRole('button', { name: '切换到变更', exact: true }).click();
  const hint = page.getByText('选择未跟踪文件可查看新增内容的差异。', { exact: true });
  await expect(hint).toBeVisible();
  await expect(page.locator('.diff-file-select option').first()).toHaveText('全部文件 · 1 个变更');
  await page.getByLabel('变更类型', { exact: true }).selectOption('staged');
  await expect(page.getByText('暂无变更', { exact: true })).toBeVisible();
  await expect(hint).toHaveCount(0);
  await page.getByLabel('变更类型', { exact: true }).selectOption('working');
  await expect(hint).toBeVisible();
  await page.getByLabel('查看文件差异', { exact: true }).selectOption('README.md');
  await expect(page.locator('.diff-content pre')).toContainText('+# New project');
  await expect(hint).toHaveCount(0);
});
