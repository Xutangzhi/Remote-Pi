import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Folder } from 'lucide-react';
import { getTopDialog } from './useDialogFocus';

type Option = { value: string; label: string; description: string };
export function WorkspacePicker({ label, value, options, disabled, onChange, input }: {
  label: string; value: string; options: Option[]; disabled?: boolean; onChange: (value: string) => void;
  input?: { placeholder: string; onChange: (value: string) => void };
}) {
  const id = useId(); const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement | HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const expanded = open && options.length > 0;
  const openRef = useRef(expanded); openRef.current = expanded;
  const selected = options.find((option) => option.value === value);
  const expand = () => { setActive(Math.max(0, options.findIndex((option) => option.value === value))); setOpen(true); };
  const choose = (index: number) => { if (options[index] && !disabled) onChange(options[index].value); trigger.current?.focus({ preventScroll: true }); setOpen(false); };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    // Register before the enclosing dialog's Back handler, including while closed.
    const back = (event: Event) => { const top = getTopDialog(); if (!openRef.current || event.defaultPrevented || (top && !top.contains(root.current))) return; event.preventDefault(); event.stopImmediatePropagation(); trigger.current?.focus({ preventScroll: true }); setOpen(false); };
    document.addEventListener('pointerdown', outside); window.addEventListener('remote-pi:back', back, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('remote-pi:back', back, true); };
  }, []);
  useEffect(() => { setActive((index) => Math.min(index, Math.max(0, options.length - 1))); }, [options.length]);
  useEffect(() => { if (expanded) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [expanded, active, options.length, id]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (['ArrowDown', 'ArrowUp', ...(!input ? ['Home', 'End'] : [])].includes(event.key)) {
      event.preventDefault(); if (!expanded) { expand(); return; }
      setActive((index) => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (expanded && (event.key === 'Enter' || (!input && event.key === ' '))) { event.preventDefault(); choose(active); }
  };
  const attributes = { role: 'combobox', 'aria-label': label, 'aria-haspopup': 'listbox' as const, 'aria-expanded': expanded, 'aria-controls': expanded ? id : undefined, 'aria-activedescendant': expanded ? `${id}-${active}` : undefined, onKeyDown };
  return <div ref={root} className="workspace-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => {
    if (event.nativeEvent.isComposing) { event.stopPropagation(); return; }
    if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); trigger.current?.focus({ preventScroll: true }); setOpen(false); }
  }}>
    {input ? <div className="workspace-picker-trigger workspace-picker-editable"><Folder size={17} aria-hidden="true" />
      <input ref={(node) => { trigger.current = node; }} {...attributes} required autoFocus autoComplete="off" spellCheck={false} placeholder={input.placeholder} value={value} disabled={disabled} onFocus={expand} onClick={expand} onChange={(event) => { input.onChange(event.target.value); setActive(0); setOpen(true); }} />
      <ChevronDown size={16} className="workspace-picker-chevron" aria-hidden="true" />
    </div> : <button ref={(node) => { trigger.current = node; }} {...attributes} type="button" className="workspace-picker-trigger" disabled={disabled || !options.length} onClick={() => expanded ? setOpen(false) : expand()}>
      <Folder size={17} aria-hidden="true" /><span className="workspace-picker-copy"><strong>{selected?.label || '暂无可用选项'}</strong><small title={selected?.description}>{selected?.description || '请先添加项目或工作区'}</small></span><ChevronDown size={16} className="workspace-picker-chevron" aria-hidden="true" />
    </button>}
    {expanded && <div className="workspace-picker-list" id={id} role="listbox" aria-label={label}>
      {options.map((option, index) => <button type="button" id={`${id}-${index}`} key={option.value} role="option" tabIndex={-1} aria-selected={option.value === value} className={`workspace-picker-option ${active === index ? 'is-active' : ''}`} onClick={() => choose(index)}>
        <span className="workspace-picker-copy"><strong>{option.label}</strong><small title={option.description}>{option.description}</small></span>{option.value === value && <Check size={16} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
