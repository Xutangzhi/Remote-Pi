import { useEffect, useRef, useState } from 'react';

export function ResizeHandle({ label, horizontal = false, direction, value, min, max, onChange, onReset, onDragging }: {
  label: string; horizontal?: boolean; direction: 1 | -1; value: number; min: number; max: number;
  onChange: (value: number) => void; onReset: () => void; onDragging: (value: boolean) => void;
}) {
  const drag = useRef<{ coordinate: number; value: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const change = (next: number) => onChange(Math.round(Math.max(min, Math.min(max, next))));
  const stop = () => { drag.current = undefined; setDragging(false); onDragging(false); };
  useEffect(() => {
    const cancel = () => { drag.current = undefined; setDragging(false); onDragging(false); };
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); onDragging(false); };
  }, [onDragging]);
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuenow={Math.round(value)} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)}
    className={`resize-handle ${horizontal ? 'horizontal' : 'vertical'} ${dragging ? 'resizing' : ''}`} title={`${label}，双击恢复默认`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { coordinate: horizontal ? event.clientY : event.clientX, value }; setDragging(true); onDragging(true);
    }}
    onPointerMove={(event) => { if (drag.current) change(drag.current.value + direction * ((horizontal ? event.clientY : event.clientX) - drag.current.coordinate)); }}
    onPointerUp={(event) => { stop(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={stop} onLostPointerCapture={stop} onDoubleClick={onReset}
    onKeyDown={(event) => {
      const less = horizontal ? 'ArrowUp' : 'ArrowLeft'; const more = horizontal ? 'ArrowDown' : 'ArrowRight';
      if (![less, more, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); change(event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === more ? 16 : -16) * direction);
    }} />;
}
