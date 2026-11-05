import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { DocumentControls } from './DocumentControls';

const documentShell = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; base-uri 'none'; form-action 'none'"><style>body{margin:0;background:transparent;color:#111;color-scheme:light} .docx-wrapper{padding:8px!important;align-items:flex-start!important;background:transparent!important} section.docx{margin:0!important;flex-shrink:0} a{pointer-events:none}</style></head><body></body></html>`;
export default function WordPreview({ data }: { data: ArrayBuffer }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false); const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1); const [zoom, setZoom] = useState(1); const [error, setError] = useState('');
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const doc = frame.current!.contentDocument!;
    const content = doc.createElement('div'); const styles = doc.createElement('div');
    doc.body.replaceChildren(styles, content);
    void renderAsync(data, content, styles, { useBase64URL: true, renderAltChunks: false, ignoreLastRenderedPageBreak: false }).then(() => {
      if (disposed) return;
      const sections = doc.querySelectorAll('section.docx');
      if (!sections.length || sections.length > 200) { setError('Word 文档需包含 1–200 个分页，请拆分后预览。'); return; }
      // Document links are inert: previewing must not navigate the embedded frame.
      doc.addEventListener('click', (event) => event.preventDefault());
      setPages(sections.length);
    }).catch(() => { if (!disposed) setError('无法解析 DOCX，请检查文件是否损坏或加密。'); });
    return () => { disposed = true; };
  }, [data, ready]);
  useEffect(() => {
    if (!pages) return;
    const iframe = frame.current!; const doc = iframe.contentDocument!;
    const sections = Array.from(doc.querySelectorAll<HTMLElement>('section.docx'));
    sections.forEach((section, index) => { section.style.display = index === page - 1 ? '' : 'none'; });
    const resize = () => {
      const wrapper = doc.querySelector<HTMLElement>('.docx-wrapper')!;
      wrapper.style.zoom = String(Math.max(0.1, (iframe.clientWidth - 16) / sections[page - 1]!.offsetWidth) * zoom);
    };
    const observer = new ResizeObserver(resize); observer.observe(iframe); resize();
    iframe.contentWindow?.scrollTo(0, 0);
    return () => observer.disconnect();
  }, [pages, page, zoom]);
  return <>
    {!!pages && <DocumentControls page={page} pages={pages} zoom={zoom} onPage={setPage} onZoom={setZoom} />}
    {!pages && !error && <div className="panel-loading" role="status">正在渲染 Word…</div>}
    {error && <div className="panel-error" role="alert">{error}</div>}
    <iframe ref={frame} title="Word 文档预览" className="word-document" sandbox="allow-same-origin" srcDoc={documentShell} onLoad={() => setReady(true)} hidden={!!error} />
    <div className="panel-note">只读预览；按文档保存的分页显示，复杂排版和缺失字体可能与 Word 有差异。</div>
  </>;
}
