export function DocumentControls({ page, pages, zoom, onPage, onZoom }: {
  page: number; pages: number; zoom: number; onPage: (page: number) => void; onZoom: (zoom: number) => void;
}) {
  return <div className="document-controls">
    <button aria-label="上一页" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
    <span aria-live="polite">第 {page} / {pages} 页</span>
    <button aria-label="下一页" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
    <select aria-label="预览缩放" value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>
      <option value={1}>适合宽度</option><option value={1.5}>放大 150%</option><option value={2}>放大 200%</option>
    </select>
  </div>;
}
