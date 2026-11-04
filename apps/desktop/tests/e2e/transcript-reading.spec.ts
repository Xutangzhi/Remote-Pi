import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, TEST_PASSWORD } from '../fixtures';
import type { AskRequest, WireMessage } from '../../src/shared/pi';

async function connectedFixture(messages: WireMessage[]) {
  const fixture = await startFixture();
  fixture.histories.set('session-1', messages);
  const dir = await mkdtemp(join(tmpdir(), 'remote-pi-reading-'));
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

test('messages and code copy their original text, clipboard errors stay recoverable, and long code scrolls inside a narrow chat', async () => {
  const code = `const value = "${'long-code-'.repeat(30)}";\n  console.log(value);`;
  const answer = `**保留原始格式**\n\n\`\`\`ts\n${code}\n\`\`\``;
  const { desktop, page, close } = await connectedFixture([{ entryId: 'a-copy', role: 'assistant', content: answer }]);
  try {
    // Keep fixture clipboard checks isolated from the user's system clipboard.
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => {
        if (document.documentElement.dataset.failCopy === 'true') throw new Error('fixture clipboard denied');
        document.documentElement.dataset.copiedText = text;
      } });
    });
    await page.getByRole('button', { name: '复制回复', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-copied-text', answer);
    await expect(page.locator('.message-actions [role="status"]')).toHaveText('已复制');
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-copied-text', code);
    await page.evaluate(() => { document.documentElement.dataset.failCopy = 'true'; });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await expect(page.locator('.code-block [role="status"]')).toHaveText('复制失败，请重试');
    await page.evaluate(() => { delete document.documentElement.dataset.failCopy; });
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await expect(page.locator('.code-block [role="status"]')).toHaveText('已复制');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 800));
    await expect.poll(() => page.locator('.code-block pre').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect.poll(() => page.locator('.transcript-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByLabel('发送消息', { exact: true })).toBeInViewport();
  } finally { await close(); }
});

test('a replaced attachment never keeps the previous image when its new media fails, and invalid image data has a visible fallback', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=';
  const message = (image: Record<string, unknown>): WireMessage => ({ entryId: 'u-image', role: 'user', content: [{ type: 'text', text: '会话图片' }, { type: 'image', ...image }] });
  const { fixture, page, close } = await connectedFixture([message({ mimeType: 'image/png', data: png })]);
  try {
    const image = page.getByRole('img', { name: '会话附件', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1);
    fixture.emit('session-1', { type: 'message.end', message: message({ mimeType: 'image/png', mediaId: 'a'.repeat(64) }) });
    await expect(page.getByTestId('message-user')).toContainText('图片加载失败');
    await expect(image).toHaveCount(0);
    fixture.emit('session-1', { type: 'message.end', message: message({ mimeType: 'image/png', data: png }) });
    await expect(image).toBeVisible();
    await expect(page.getByTestId('message-user')).not.toContainText('图片加载失败');
    fixture.emit('session-1', { type: 'message.end', message: message({ mimeType: 'image/png', data: 'aW52YWxpZA==' }) });
    await expect(page.getByTestId('message-user')).toContainText('图片加载失败');
    await expect(image).toHaveCount(0);
  } finally { await close(); }
});

const translationQuestion = {
  id: 'translation_type', question: '请选择翻译方式',
  options: [{ value: 'literal', label: '直译' }, { value: 'natural', label: '意译' }],
};
const askMessage = (questions: AskRequest['questions'] = [translationQuestion]): WireMessage => ({
  entryId: 'ask-result', role: 'toolResult', toolName: 'ask_user', toolCallId: 'ask-tool', content: '等待回答', isError: false,
  details: { ask: { askId: 'translation-ask', askedAt: new Date().toISOString(), questions } },
});

test('single answers can be deselected and custom text replaces the selected option', async () => {
  const { fixture, page, close } = await connectedFixture([askMessage()]);
  try {
    const form = page.locator('form.ask-form');
    const literal = form.getByRole('radio', { name: '直译', exact: true });
    await literal.click();
    await expect(literal).toBeChecked();
    await literal.click();
    await expect(literal).not.toBeChecked();
    await expect(form.getByRole('button', { name: '提交回答' })).toBeDisabled();
    await literal.click();
    await form.getByRole('textbox').fill('  保留专业术语  ');
    await expect(literal).not.toBeChecked();
    await form.getByRole('button', { name: '提交回答' }).click();
    await expect(page.locator('.ask-form')).toHaveText('回答已提交');
    const call = fixture.calls.find((call) => call.path.endsWith('/ask/submit'))!;
    expect(call.body.answers).toEqual([{ id: 'translation_type', values: [], otherText: '保留专业术语' }]);
  } finally { await close(); }
});

test('single choices replace custom text while multiple choices can include a custom answer', async () => {
  const { fixture, page, close } = await connectedFixture([askMessage([
    translationQuestion,
    { id: 'targets', question: '目标格式', multiple: true, options: [{ value: 'md', label: 'Markdown' }, { value: 'pdf', label: 'PDF' }] },
    { id: 'note', question: '其他要求', options: [] },
  ])]);
  try {
    const form = page.locator('form.ask-form');
    const single = form.getByRole('group', { name: '请选择翻译方式', exact: true });
    await single.getByRole('textbox').fill('原本的自定义回答');
    await single.getByRole('radio', { name: '意译', exact: true }).click();
    await expect(single.getByRole('textbox')).toHaveValue('');
    const multiple = form.getByRole('group', { name: '目标格式', exact: true });
    await multiple.getByRole('checkbox', { name: 'Markdown', exact: true }).check();
    await multiple.getByRole('checkbox', { name: 'PDF', exact: true }).check();
    await multiple.getByRole('checkbox', { name: 'PDF', exact: true }).uncheck();
    await multiple.getByRole('textbox').fill('  同时提供 HTML  ');
    await expect(multiple.getByRole('checkbox', { name: 'Markdown', exact: true })).toBeChecked();
    await form.getByRole('group', { name: '其他要求', exact: true }).getByRole('textbox').fill('保留引用');
    await form.getByRole('button', { name: '提交回答' }).click();
    await expect(page.locator('.ask-form')).toHaveText('回答已提交');
    expect(fixture.calls.find((call) => call.path.endsWith('/ask/submit'))!.body.answers).toEqual([
      { id: 'translation_type', values: ['natural'] },
      { id: 'targets', values: ['md'], otherText: '同时提供 HTML' },
      { id: 'note', values: [], otherText: '保留引用' },
    ]);
  } finally { await close(); }
});

test('a failed answer remains editable and the question can still be cancelled', async () => {
  const { fixture, page, close } = await connectedFixture([askMessage()]);
  try {
    fixture.askSubmitFailures.set('session-1', 'Question translation_type accepts a single answer');
    const form = page.locator('form.ask-form');
    const literal = form.getByRole('radio', { name: '直译', exact: true });
    await literal.click();
    await form.getByRole('button', { name: '提交回答' }).click();
    await expect(page.getByText(/Question translation_type accepts a single answer/)).toBeVisible();
    await expect(literal).toBeEnabled();
    await expect(literal).toBeChecked();
    await literal.click();
    await expect(literal).not.toBeChecked();
    await form.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('.ask-form')).toHaveText('已取消回答');
    expect(fixture.calls.find((call) => call.path.endsWith('/ask/cancel'))!.body).toEqual({ cwd: '/srv/projects/remote-pi', askId: 'translation-ask' });
    expect(fixture.calls.filter((call) => call.path.endsWith('/ask/submit'))).toHaveLength(1);
  } finally { await close(); }
});
