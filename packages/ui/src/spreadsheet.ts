import { read, utils } from 'xlsx';
import type { TablePreview } from '@remote-pi/core/file-preview';

export function readSpreadsheet(data: ArrayBuffer, path: string): TablePreview {
  const extension = path.split('.').at(-1)?.toLowerCase();
  if (extension === 'xlsx' || extension === 'ods') {
    const signature = new Uint8Array(data, 0, Math.min(data.byteLength, 2));
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('表格文件损坏，或内容与扩展名不符。');
  }
  const plain = extension === 'csv' || extension === 'tsv';
  const source = plain ? new TextDecoder('utf-8', { fatal: true }).decode(data) : data;
  const book = read(source, { type: plain ? 'string' : 'array', dense: true, raw: true, sheetRows: 1001, cellFormula: false, cellHTML: false, cellStyles: false, ...(extension === 'tsv' ? { FS: '\t' } : extension === 'csv' ? { FS: ',' } : {}) });
  if (!book.SheetNames.length) throw new Error('文件中没有可预览的工作表。');
  return {
    truncated: book.SheetNames.length > 20,
    sheets: book.SheetNames.slice(0, 20).map((name) => {
      const sheet = book.Sheets[name]!;
      if (!sheet['!ref']) return { name, rows: [], columns: [], truncated: false };
      const range = utils.decode_range(sheet['!fullref'] || sheet['!ref']);
      const endRow = Math.min(range.e.r, 999); const endColumn = Math.min(range.e.c, 49);
      let truncated = range.e.r > endRow || range.e.c > endColumn;
      const rows: string[][] = [];
      for (let row = 0; row <= endRow; row++) {
        const cells: string[] = [];
        for (let column = 0; column <= endColumn; column++) {
          const cell = sheet['!data']?.[row]?.[column];
          const text = cell ? utils.format_cell(cell) : '';
          if (text.length > 2000) truncated = true;
          cells.push(text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
        }
        rows.push(cells);
      }
      if (rows.every((row) => row.every((cell) => cell === ''))) return { name, rows: [], columns: [], truncated };
      return { name, rows, columns: Array.from({ length: endColumn + 1 }, (_, column) => utils.encode_col(column)), truncated };
    }),
  };
}
