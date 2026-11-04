import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteFilePath } from '../src/renderer/workspace/file-links';
import { createFileReferenceChecker, filePreviewError, fileLinkPath, remarkFileReferences } from '../../../packages/ui/src/file-links';

const root = '/srv/projects/remote-pi';
test('file links resolve against the remote workspace or the current document directory', () => {
  for (const href of ['docs/report.md', './docs/report.md', `${root}/docs/report.md`, `file://${root}/docs/report.md`, `file://localhost${root}/docs/report.md`]) {
    assert.equal(remoteFilePath(href, root), 'docs/report.md');
  }
  assert.equal(remoteFilePath('../src/main.ts:12:4', root, 'docs'), 'src/main.ts');
  assert.equal(remoteFilePath('next.md#section', root, `${root}/docs`), 'docs/next.md');
  assert.equal(remoteFilePath('docs/中文%20报告.md#L12-L18', root), 'docs/中文 报告.md');
  assert.equal(remoteFilePath('docs/a%23b.txt', root), 'docs/a#b.txt');
  assert.equal(remoteFilePath('README.md:12', root), 'README.md');
  assert.equal(remoteFilePath('/report.md', '/'), 'report.md');
});

test('paths outside the workspace remain absolute for the server to enforce access', () => {
  assert.equal(remoteFilePath('/srv/projects/remote-pi-other/report.md', root), '/srv/projects/remote-pi-other/report.md');
  assert.equal(remoteFilePath('../outside.md', root), '/srv/projects/outside.md');
  assert.equal(remoteFilePath('~/report.md', root), '~/report.md');
});

test('web links, fragments, malformed paths and unsupported schemes are not remote files', () => {
  for (const href of ['', '#section', '?query', '//example.com/report.md', 'https://example.com/report.md', 'mailto:a@example.com', 'javascript:alert(1)', 'javascript:1', 'data:text/plain,test', 'file://other-server/report.md', '%E0%A4%A', 'docs/%00file.md']) {
    assert.equal(fileLinkPath(href), undefined, href);
    assert.throws(() => remoteFilePath(href, root), /无法识别文件路径/);
  }
});

test('inline paths become links while code blocks and existing link labels stay intact', () => {
  const inline = (value: string) => ({ type: 'inlineCode', value });
  const tree = { type: 'root', children: [
    { type: 'paragraph', children: [inline('docs/report.md'), inline('docs/报告.md'), inline('src/main.ts:12'), inline('const value = 1'), inline('https://example.com')] },
    { type: 'code', value: 'src/main.ts' },
    { type: 'link', url: 'README.md', children: [inline('README.md')] },
  ] };
  remarkFileReferences()(tree);
  assert.deepEqual(tree.children[0]!.children?.map((child) => child.type), ['link', 'link', 'link', 'inlineCode', 'inlineCode']);
  assert.equal(tree.children[1]!.type, 'code');
  assert.equal(tree.children[2]!.children?.[0]!.type, 'inlineCode');
  assert.deepEqual((tree.children[0]!.children?.[0] as any).data, { hProperties: { 'data-file-reference': true } });
  assert.equal((tree.children[2] as any).data, undefined);
});


test('automatic references require an exact file, including hidden and untracked paths', async () => {
  const queries: string[] = [];
  const check = createFileReferenceChecker(async (path) => {
    queries.push(path);
    return ['.loopx/registry.json', 'docs/report.md', 'folder.txt/', 'backup/missing.txt', 'Main.ts'].map((path) => ({ path }));
  }, root);
  assert.equal(await check('.loopx/registry.json'), true);
  assert.equal(await check('docs/report.md:12'), true);
  assert.equal(await check('folder.txt'), false);
  assert.equal(await check('missing.txt'), false);
  assert.equal(await check('main.ts'), false);
  assert.equal(await check('https://example.com/file.txt'), false);
  assert.deepEqual(queries, ['.loopx/registry.json', 'docs/report.md', 'folder.txt', 'missing.txt', 'main.ts']);
  const inDocument = createFileReferenceChecker(async (path) => [{ path: 'docs/next.md' }], root, `${root}/docs`);
  assert.equal(await inDocument('next.md'), true);
});

test('reference checks coalesce pending requests but do not cache missing or removed files', async () => {
  let calls = 0;
  let files: { path: string }[] = [];
  const check = createFileReferenceChecker(async () => { calls++; return files; }, root);
  assert.deepEqual(await Promise.all([check('new.txt'), check('./new.txt')]), [false, false]);
  assert.equal(calls, 1);
  files = [{ path: 'new.txt' }];
  assert.equal(await check('new.txt'), true);
  files = [];
  assert.equal(await check('new.txt'), false);
  const denied = createFileReferenceChecker(async () => { throw new Error('Path is outside allowed paths'); }, root);
  assert.equal(await denied('/private/file.txt'), false);
});

test('missing preview errors show the resolved location without Electron transport noise', () => {
  const error = new Error("Error invoking remote method 'pi:request': Error: Path does not exist");
  assert.equal(filePreviewError(error, '.loopx/registry.json', root), `无法预览 ${root}/.loopx/registry.json：文件不存在。聊天中的路径可能只是示例，或文件尚未创建、已被移动。`);
  assert.match(filePreviewError(new Error('Permission denied'), '/outside/report.md', root), /^无法预览 \/outside\/report.md：Permission denied$/);
  assert.match(filePreviewError(error, '~/report.md', root), /^无法预览 ~\/report.md：文件不存在/);
});
