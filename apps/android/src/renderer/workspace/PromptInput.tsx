import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type RefObject } from 'react';
import type { FileSuggestion, Model, SessionRef, SlashCommand } from '../../shared/pi';
import { piRequest, sessionInput } from './api';
import { applyCompletion, commandCompletions, completionTrigger, fileCompletion, modelCompletions, type PromptCompletion } from './prompt-completions';

export function PromptInput({ inputRef, session, projectId, workspaceId, models, history, value, disabled, connected = true, onChange, onSend, onPaste }: {
  inputRef: RefObject<HTMLTextAreaElement | null>; session: SessionRef; projectId: string; workspaceId: string; models: Model[]; history: string[];
  value: string; disabled: boolean; connected?: boolean; onChange: (value: string) => void; onSend: () => void; onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const [cursor, setCursor] = useState(value.length);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [results, setResults] = useState<{ key: string; items: PromptCompletion[] }>({ key: '', items: [] });
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const composing = useRef(false);
  const historySelection = useRef<{ items: string[]; index: number; draft: string } | undefined>(undefined);
  const selectionAfterEdit = useRef<number | undefined>(undefined);
  const trigger = completionTrigger(value, cursor);
  const triggerKey = trigger ? JSON.stringify(trigger) : '';
  const requestKey = `${session.id}\0${session.cwd}\0${projectId}\0${workspaceId}\0${triggerKey}`;
  const items = results.key === requestKey ? results.items : [];
  const open = focused && connected && !disabled && !dismissed && Boolean(trigger);

  useLayoutEffect(() => {
    const input = inputRef.current; if (!input) return;
    const resize = () => { input.style.height = '0px'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth; resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [value, inputRef]);

  useLayoutEffect(() => {
    const browsing = historySelection.current;
    if (browsing && value !== browsing.items[browsing.index]) historySelection.current = undefined;
    if (selectionAfterEdit.current === undefined) return;
    const position = selectionAfterEdit.current; selectionAfterEdit.current = undefined;
    inputRef.current?.setSelectionRange(position, position); setCursor(position);
  }, [value, inputRef]);
  useEffect(() => {
    let active = true;
    setResults({ key: '', items: [] }); setSelected(0); setError(''); setLoading(open);
    if (!open || !trigger) return;
    const current = trigger;
    const timer = setTimeout(() => {
      const request = current.kind === 'command'
        ? piRequest<SlashCommand[]>('session.commands', sessionInput(session)).then((commands) => commandCompletions(commands, current.query))
        : current.kind === 'file'
          ? piRequest<FileSuggestion[]>('files.suggest', { projectId, workspaceId, query: current.query, scope: current.scope }).then((files) => files.map((file) => ({ ...fileCompletion(file.path, current), detail: file.path.endsWith('/') ? '目录' : file.kind === 'tracked' ? '已跟踪' : file.kind === 'untracked' ? '未跟踪' : '文件' })))
          : Promise.resolve(modelCompletions(models, current.query));
      void request.then((result) => { if (active) setResults({ key: requestKey, items: result }); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (active) setLoading(false); });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [open, triggerKey, session.id, session.cwd, projectId, workspaceId, models, requestKey]);
  useEffect(() => { document.getElementById(`prompt-option-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  useEffect(() => {
    if (!open) return;
    const back = (event: Event) => { if (!event.defaultPrevented) { event.preventDefault(); setDismissed(true); } };
    window.addEventListener('remote-pi:back', back, true);
    return () => window.removeEventListener('remote-pi:back', back, true);
  }, [open]);

  const pick = (item: PromptCompletion) => {
    if (!trigger) return;
    const next = applyCompletion(value, trigger, item);
    selectionAfterEdit.current = next.cursor; onChange(next.text); setCursor(next.cursor); setResults({ key: '', items: [] }); setDismissed(!item.directory); inputRef.current?.focus();
  };
  return <div className="prompt-input">
    {open && <div className="prompt-completions" role="listbox" id="prompt-completions" aria-label={trigger?.kind === 'command' ? '命令与技能' : trigger?.kind === 'file' ? '远端文件' : '模型引用'}>
      <div className="completion-heading">{trigger?.kind === 'command' ? '命令 · Skills · 提示词模板' : trigger?.kind === 'file' ? trigger.scope === 'all' ? '全部远端文件与目录' : '远端文件与目录' : '模型引用'}<small>↑↓ 选择 · Tab / Enter 补全 · Esc 关闭</small></div>
      {items.map((item, index) => <button type="button" role="option" aria-selected={selected === index} id={`prompt-option-${index}`} key={`${item.text}:${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(item)} onMouseEnter={() => setSelected(index)}><span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>{item.detail && <em>{item.detail}</em>}</button>)}
      {!items.length && <p role="status">{loading ? '正在读取远端能力…' : error || (trigger?.kind === 'command' && trigger.query.startsWith('skill:') ? '当前会话没有匹配的 Skill；安装后可运行 /reload 刷新。' : '没有匹配结果')}</p>}
    </div>}
    <textarea ref={inputRef} disabled={disabled} aria-label="发送消息" aria-autocomplete="list" aria-controls={open ? 'prompt-completions' : undefined} aria-activedescendant={open && items[selected] ? `prompt-option-${selected}` : undefined} placeholder="描述任务，/ 命令 · /skill: 技能 · @ 文件" value={value} rows={1}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSelect={(event) => { setCursor(event.currentTarget.selectionStart); }}
      onChange={(event) => { historySelection.current = undefined; setCursor(event.target.selectionStart); setDismissed(false); onChange(event.target.value); }} onPaste={onPaste}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; setCursor(event.currentTarget.selectionStart); }}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (connected) { setDismissed(true); onSend(); } return; }
        if (open && event.key === 'Escape') { event.preventDefault(); setDismissed(true); return; }
        if (open && items.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key) && !event.shiftKey) {
          event.preventDefault();
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setSelected((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          else pick(items[selected] || items[0]!);
          return;
        }
        if (!open && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const input = event.currentTarget; const position = input.selectionStart;
          const up = event.key === 'ArrowUp';
          const atEdge = up ? !value.slice(0, position).includes('\n') : !value.slice(position).includes('\n');
          if (position === input.selectionEnd && atEdge) {
            const browsing = historySelection.current || { items: history, index: history.length, draft: value };
            const index = Math.max(0, Math.min(browsing.items.length, browsing.index + (up ? -1 : 1)));
            if (index !== browsing.index) {
              event.preventDefault();
              const text = index === browsing.items.length ? browsing.draft : browsing.items[index]!;
              historySelection.current = index === browsing.items.length ? undefined : { ...browsing, index };
              const cursor = up ? 0 : text.length;
              selectionAfterEdit.current = text === value ? undefined : cursor; input.setSelectionRange(cursor, cursor); setCursor(cursor); setDismissed(true); onChange(text);
            } else if (historySelection.current) event.preventDefault();
          }
        }
      }} />
  </div>;
}
