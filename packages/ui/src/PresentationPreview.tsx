import { useEffect, useRef, useState } from 'react';
import { DocumentControls } from './DocumentControls';

export default function PresentationPreview({ data }: { data: ArrayBuffer }) {
  const [page, setPage] = useState(1); const [pages, setPages] = useState(0); const [zoom, setZoom] = useState(1);
  const [url, setURL] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(true);
  const worker = useRef<Worker>(null); const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const parser = new Worker(new URL('./presentation.worker.ts', import.meta.url), { type: 'module' });
    worker.current = parser; let objectURL = '';
    parser.onmessage = (event: MessageEvent<{ svg?: string; pages: number; error?: string }>) => {
      clearTimeout(timer.current); setBusy(false);
      if (event.data.error) { setError(event.data.error); return; }
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = URL.createObjectURL(new Blob([event.data.svg!], { type: 'image/svg+xml' }));
      setURL(objectURL); setPages(event.data.pages);
    };
    parser.onerror = () => { clearTimeout(timer.current); setError('无法解析此演示文稿。'); setBusy(false); };
    return () => { parser.terminate(); clearTimeout(timer.current); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [data]);
  useEffect(() => {
    setBusy(true);
    timer.current = setTimeout(() => { worker.current?.terminate(); setError('演示文稿解析超时，请拆分文件后重试。'); setBusy(false); }, 20_000);
    const copy = pages ? undefined : data.slice(0);
    worker.current!.postMessage({ data: copy, page }, copy ? [copy] : []);
    return () => clearTimeout(timer.current);
  }, [data, page]);
  return <>
    {!!pages && <DocumentControls page={page} pages={pages} zoom={zoom} onPage={setPage} onZoom={setZoom} />}
    {busy && !error && <div className="panel-loading" role="status">正在渲染演示文稿…</div>}
    {error ? <div className="panel-error" role="alert">{error}</div> : <div className="document-viewport">{url && !busy && <img style={{ width: `${zoom * 100}%` }} src={url} alt={`PPT 第 ${page} 页`} onError={() => setError('此幻灯片无法显示。')} />}</div>}
    <div className="panel-note">静态预览；动画、嵌入媒体和部分复杂效果不显示，字体与排版可能存在差异。</div>
  </>;
}
