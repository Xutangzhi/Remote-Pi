import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteFilePath } from '../src/renderer/workspace/file-links';
import { fileLinkPath, remarkFileReferences } from '../../../packages/ui/src/file-links';

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
});
