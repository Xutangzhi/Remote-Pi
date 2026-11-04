import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerURL from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { DocumentControls } from './DocumentControls';

GlobalWorkerOptions.workerSrc = workerURL;
export default function PdfPreview({ data }: { data: ArrayBuffer }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1); const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(true);
  const [rendered, setRendered] = useState('');
  const [width, setWidth] = useState(300);
  const renderKey = `${page}:${width}:${zoom}`;
  const viewport = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(100, entry.contentRect.width - 16)); });
    observer.observe(viewport.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    const base = new URL('pdfjs/', document.baseURI).href;
    const task = getDocument({ data: data.slice(0), cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, isEvalSupported: false });
    task.onPassword = () => { if (!disposed) { setError('此 PDF 已加密，请先解锁后预览。'); setBusy(false); } void task.destroy(); };
    void task.promise.then((document) => { if (!disposed) setPdf(document); }).catch(() => { if (!disposed) { setError('无法解析 PDF，请检查文件是否损坏或加密。'); setBusy(false); } });
    return () => { disposed = true; void task.destroy(); };
  }, [data]);
  useEffect(() => {
    if (!pdf) return;
    let disposed = false; let render: RenderTask | undefined;
    setBusy(true);
    void (async () => {
      const sheet = await pdf.getPage(page);
      if (disposed) return;
      const original = sheet.getViewport({ scale: 1 });
      const scale = Math.min(width * zoom / original.width, 4096 / Math.max(original.width, original.height));
      const view = sheet.getViewport({ scale });
      const density = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(view.width, view.height));
      const target = canvas.current!;
      target.width = Math.ceil(view.width * density); target.height = Math.ceil(view.height * density);
      target.style.width = `${view.width}px`; target.style.height = `${view.height}px`;
      render = sheet.render({ canvas: target, viewport: view, transform: [density, 0, 0, density, 0, 0] });
      await render.promise;
      if (!disposed) { setRendered(renderKey); setBusy(false); }
    })().catch((reason) => { if (!disposed && reason?.name !== 'RenderingCancelledException') { setError('此 PDF 页面无法显示。'); setBusy(false); } });
    return () => { disposed = true; render?.cancel(); };
  }, [pdf, page, width, zoom]);
  return <>
    {pdf && <DocumentControls page={page} pages={pdf.numPages} zoom={zoom} onPage={setPage} onZoom={setZoom} />}
    {busy && !error && <div className="panel-loading" role="status">正在渲染 PDF…</div>}
    {error && <div className="panel-error" role="alert">{error}</div>}
    <div className="document-viewport" ref={viewport}><canvas ref={canvas} role="img" aria-label={`PDF 第 ${page} 页`} data-rendered={!busy && !error && rendered === renderKey} hidden={!!error} /></div>
  </>;
}
