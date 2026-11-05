import { getBridge } from './bridge';
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { filePreviewFormat, type TablePreview } from '@remote-pi/core/file-preview';

const PdfPreview = lazy(() => import('./PdfPreview'));
const WordPreview = lazy(() => import('./WordPreview'));
const PresentationPreview = lazy(() => import('./PresentationPreview'));

type FilePreviewProps = { path: string; projectId: string; workspaceId: string };

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="rich-file-preview"><div className="panel-error" role="alert">此文件的预览组件发生错误。可以关闭面板返回聊天，或选择其他文件。</div></div> : this.props.children;
  }
}

export function FilePreview(props: FilePreviewProps) {
  return <PreviewBoundary key={JSON.stringify([props.projectId, props.workspaceId, props.path])}><FilePreviewContent {...props} /></PreviewBoundary>;
}

function FilePreviewContent({ path, projectId, workspaceId }: FilePreviewProps) {
  const format = filePreviewFormat(path)!;
  const [documentData, setDocumentData] = useState<ArrayBuffer>();
  const [url, setURL] = useState('');
  const [table, setTable] = useState<TablePreview>();
  const [sheetIndex, setSheetIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const id = crypto.randomUUID();
    let objectURL = ''; let worker: Worker | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    setDocumentData(undefined); setURL(''); setTable(undefined); setSheetIndex(0); setError(''); setLoading(true);
    const load = async () => {
      if (format.kind === 'legacy-office') { setError('旧版 DOC／PPT 暂不支持直接预览，请先转换为 DOCX、PPTX 或 PDF。'); setLoading(false); return; }
      const source = await getBridge().prepareFilePreview({ id, projectId, workspaceId, path });
      if (controller.signal.aborted) return;
      const response = await fetch(source, { signal: controller.signal });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      if (format.kind === 'table') {
        worker = new Worker(new URL('./spreadsheet.worker.ts', import.meta.url), { type: 'module' });
        timer = setTimeout(() => { worker?.terminate(); setError('表格解析超时，请缩小文件后重试。'); setLoading(false); }, 15_000);
        worker.onmessage = (event: MessageEvent<{ result?: TablePreview; error?: string }>) => {
          clearTimeout(timer); worker?.terminate();
          if (controller.signal.aborted) return;
          if (event.data.error) setError(event.data.error); else setTable(event.data.result);
          setLoading(false);
        };
        worker.onerror = () => { clearTimeout(timer); worker?.terminate(); if (!controller.signal.aborted) { setError('无法解析此表格，请检查文件是否损坏或加密。'); setLoading(false); } };
        worker.postMessage({ data, path }, [data]);
      } else if (['pdf', 'word', 'presentation'].includes(format.kind)) {
        setDocumentData(data); setLoading(false);
      } else {
        objectURL = URL.createObjectURL(new Blob([data], { type: format.mime }));
        setURL(objectURL); setLoading(false);
      }
    };
    void load().catch((reason) => { if (!controller.signal.aborted) { setError(`无法预览 ${path}：${(reason as Error).message}`); setLoading(false); } });
    return () => { controller.abort(); worker?.terminate(); clearTimeout(timer); if (objectURL) URL.revokeObjectURL(objectURL); void getBridge().releaseFilePreview(id).catch(() => {}); };
  }, [path, projectId, workspaceId]);
  const sheet = table?.sheets[sheetIndex];
  const mediaError = () => setError('此文件无法播放：当前客户端不支持其音视频编码，或文件已损坏。可尝试转换为 MP4（H.264/AAC）、WebM、MP3 或 WAV。');
  return <div className={`rich-file-preview ${format.kind}-preview`}>
    {loading && <div className="panel-loading" role="status"><span className="spinner" />正在加载{format.kind === 'table' ? '并解析表格' : '文件'}…</div>}
    {error && <div className="panel-error" role="alert">{error}</div>}
    {!error && documentData && <Suspense fallback={<div className="panel-loading" role="status">正在加载文档预览…</div>}>{format.kind === 'pdf' ? <PdfPreview key={path} data={documentData} /> : format.kind === 'word' ? <WordPreview key={path} data={documentData} /> : <PresentationPreview key={path} data={documentData} />}</Suspense>}
    {!error && url && (format.kind === 'video' ? <video controls playsInline preload="metadata" src={url} aria-label={`视频预览：${path}`} onError={mediaError} /> : format.kind === 'audio' ? <audio controls preload="metadata" src={url} aria-label={`音频预览：${path}`} onError={mediaError} /> : <img src={url} alt={path} onError={() => setError('无法显示此图片，文件可能损坏或格式不受支持。')} />)}
    {!error && sheet && <><label className="sheet-selector">工作表<select aria-label="选择工作表" value={sheetIndex} onChange={(event) => setSheetIndex(Number(event.target.value))}>{table!.sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label><div className="sheet-grid">{sheet.rows.length ? <table aria-label={`${sheet.name} 表格预览`}><thead><tr><th aria-label="行号" />{sheet.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{sheet.rows.map((row, index) => <tr key={index}><th scope="row">{index + 1}</th>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table> : <div className="panel-empty">此工作表为空</div>}</div><div className="panel-note">只读预览；公式显示文件中保存的计算结果。{(sheet.truncated || table!.truncated) && '内容已截断：最多显示 20 个工作表，每表前 1000 行、50 列，单元格最多 2000 字符。'}</div></>}
  </div>;
}
