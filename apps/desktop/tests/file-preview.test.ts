import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { utils, write } from 'xlsx';
import { readSpreadsheet } from '../../../packages/ui/src/spreadsheet';
import { filePreviewFormat } from '../src/shared/file-preview';
import { PiClient } from '../src/main/pi-client';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
test('CSV and TSV preserve quoting, newlines, empty cells, leading zeroes and Unicode', () => {
  const csv = readSpreadsheet(bytes('\uFEFF姓名,编号,备注\r\n张三,001,"第一行\n第二行,含逗号"\r\n李四,,"引号""内容"'), 'test.csv');
  assert.deepEqual(csv.sheets[0]!.rows, [['姓名', '编号', '备注'], ['张三', '001', '第一行\n第二行,含逗号'], ['李四', '', '引号"内容']]);
  assert.deepEqual(readSpreadsheet(bytes('名称\t值\n测试\t007'), 'test.tsv').sheets[0]!.rows, [['名称', '值'], ['测试', '007']]);
});
test('Excel sheets retain formatted cached values and large sheets are visibly bounded', () => {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([['名称', '金额'], ['样例', 12.5]]);
  sheet.B2!.z = '0.00'; sheet.C2 = { t: 'n', v: 25, f: 'B2*2' }; sheet['!ref'] = 'A1:C2';
  utils.book_append_sheet(book, sheet, '数据');
  utils.book_append_sheet(book, utils.aoa_to_sheet([]), '空表');
  utils.book_append_sheet(book, utils.aoa_to_sheet(Array.from({ length: 1200 }, (_, i) => [i])), '长表');
  for (const bookType of ['xlsx', 'xls', 'ods'] as const) {
    const result = readSpreadsheet(write(book, { bookType, type: 'array' }), `test.${bookType}`);
    assert.equal(result.sheets[0]!.rows[1]![2], '25');
    assert.equal(result.sheets[1]!.rows.length, 0);
    assert.equal(result.sheets[2]!.rows.length, 1000);
    assert.equal(result.sheets[2]!.truncated, true);
  }
  assert.equal(readSpreadsheet(write(book, { bookType: 'xlsx', type: 'array' }), 'test.xlsx').sheets[0]!.rows[1]![1], '12.50');
  assert.throws(() => readSpreadsheet(bytes('not a workbook'), 'broken.xlsx'), /损坏/);
});
test('preview classification has explicit media types and limits', () => {
  assert.equal(filePreviewFormat('CLIP.MP4')?.kind, 'video');
  assert.equal(filePreviewFormat('audio.wav')?.kind, 'audio');
  assert.equal(filePreviewFormat('report.xlsx')?.limit, 10 * 1024 * 1024);
  for (const [path, kind] of [['report.PDF', 'pdf'], ['report.docx', 'word'], ['slides.pptx', 'presentation'], ['old.doc', 'legacy-office'], ['old.ppt', 'legacy-office']]) {
    assert.equal(filePreviewFormat(path!)?.kind, kind);
    assert.equal(filePreviewFormat(path!)?.limitMiB, 20);
  }
  assert.equal(filePreviewFormat('index.html'), undefined);
});

test('prototype property names are unsupported file extensions', () => {
  for (const extension of Object.getOwnPropertyNames(Object.prototype)) {
    assert.equal(filePreviewFormat(`file.${extension}`), undefined, extension);
    assert.equal(filePreviewFormat(`file.${extension.toUpperCase()}`), undefined, extension);
  }
});

test('binary preview uses the scoped download route and rejects oversized data and redirects', async () => {
  let mode = 'ok'; let requested = ''; let closed = false;
  const server = createServer((request, response) => {
    requested = request.url || '';
    if (mode === 'redirect') { response.writeHead(302, { location: '/other' }); response.end(); return; }
    if (mode === 'large') { response.writeHead(200, { 'content-length': 11 * 1024 * 1024 }); response.end(); return; }
    if (mode === 'chunked') {
      response.writeHead(200);
      const timer = setInterval(() => { response.write(Buffer.alloc(256 * 1024)); }, 1);
      response.on('close', () => { closed = true; clearInterval(timer); }); return;
    }
    response.end('a,b\n1,2');
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new PiClient(); client.connect(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const input = { projectId: 'p', workspaceId: 'w', path: 'docs/a b.csv' };
  try {
    assert.equal(await (await client.filePreview(input)).text(), 'a,b\n1,2');
    assert.equal(new URL(requested, 'http://test').pathname, '/api/machines/local/projects/p/workspaces/w/file/preview');
    assert.equal(new URL(requested, 'http://test').searchParams.get('path'), input.path);
    assert.equal(new URL(requested, 'http://test').searchParams.get('download'), '1');
    mode = 'large'; await assert.rejects(client.filePreview(input), /10 MiB/);
    mode = 'redirect'; await assert.rejects(client.filePreview(input));
    mode = 'chunked'; await assert.rejects((await client.filePreview(input)).arrayBuffer(), /10 MiB/);
    await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(closed, true);
    closed = false;
    const controller = new AbortController(); const response = await client.filePreview(input, controller.signal);
    const reading = response.arrayBuffer(); controller.abort(); await assert.rejects(reading);
    await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(closed, true);
    await assert.rejects(client.filePreview({ ...input, path: 'index.html' }), /暂不支持/);
  } finally { client.disconnect(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
