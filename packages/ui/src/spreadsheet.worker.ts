import { readSpreadsheet } from './spreadsheet';
self.onmessage = (event: MessageEvent<{ data: ArrayBuffer; path: string }>) => {
  try { self.postMessage({ result: readSpreadsheet(event.data.data, event.data.path) }); }
  catch (error) { self.postMessage({ error: `无法解析表格：${(error as Error).message}` }); }
};
