import { useEffect, useState } from 'react';
import type { CommandResult, SessionInfo } from '../../shared/pi';
import { piRequest, sessionInput } from './api';
import { useDialogFocus } from './useDialogFocus';

export interface PendingCommand { session: SessionInfo; result: Extract<CommandResult, { type: 'select' | 'tree' }>; local?: 'model' | 'resume'; }

export function CommandDialog({ pending, onClose, onResult, onLocal }: {
  pending: PendingCommand; onClose: () => void; onResult: (result: CommandResult, reload?: boolean) => void; onLocal: (value: string) => Promise<void>;
}) {
  const { result, session } = pending;
  const dialogRef = useDialogFocus<HTMLFormElement>();
  const [value, setValue] = useState('');
  const [summaryMode, setSummaryMode] = useState('none');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    const back = (event: Event) => { if (!event.defaultPrevented) { event.preventDefault(); if (!busy) onClose(); } };
    window.addEventListener('keydown', escape); window.addEventListener('remote-pi:back', back, true);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('remote-pi:back', back, true); };
  }, [busy, onClose]);
  const submit = async (fork = false) => {
    setBusy(true); setError('');
    try {
      if (pending.local) { await onLocal(value); onClose(); return; }
      if (result.type === 'select') {
        const next = await piRequest<CommandResult>('session.command.respond', { ...sessionInput(session), requestId: result.requestId, value });
        onResult(next); return;
      }
      if (fork) {
        const next = await piRequest<{ cancelled: boolean; session?: SessionInfo; promptDraft?: string }>('session.tree.fork', { ...sessionInput(session), entryId: value, expectedLeafId: result.tree.activeLeafId });
        if (next.cancelled) { setError('分叉已取消。'); return; }
        onResult({ type: 'done', session: next.session, promptDraft: next.promptDraft }, true);
      } else {
        const next = await piRequest<{ cancelled: boolean; editorText?: string }>('session.tree.navigate', { ...sessionInput(session), targetId: value, expectedLeafId: result.tree.activeLeafId, summaryMode, instructions });
        if (next.cancelled) { setError('切换已取消。'); return; }
        onResult({ type: 'done', session, promptDraft: next.editorText }, true);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const title = result.type === 'select' ? result.title : '会话历史树';
  return <div className="modal-backdrop"><form ref={dialogRef} tabIndex={-1} className={`workspace-dialog command-dialog ${result.type === 'tree' ? 'tree-command-dialog' : ''}`} role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h2>{title}</h2>
    {result.type === 'select' ? <label className="field">选择选项<select autoFocus aria-label={title} disabled={busy} value={value} onChange={(event) => setValue(event.target.value)}><option value="" disabled>请选择</option>{result.options.map((option) => <option key={option.value} value={option.value}>{option.label}{option.description ? ` · ${option.description}` : ''}</option>)}</select></label> : <>
      <p>选择历史位置继续，或从该位置创建分叉。分叉会保留原会话；历史导航不会撤销磁盘上的文件修改。</p>
      <div className="command-tree" role="listbox" aria-label="会话历史节点">{result.tree.nodes.map((node) => {
        let depth = 0; let parent = node.parentId; const seen = new Set([node.id]);
        while (parent && !seen.has(parent)) { seen.add(parent); depth++; parent = result.tree.nodes.find((entry) => entry.id === parent)?.parentId || null; }
        return <button type="button" role="option" aria-selected={value === node.id} disabled={busy} key={node.id} style={{ paddingLeft: 12 + Math.min(depth, 12) * 14 }} onClick={() => setValue(node.id)}><small>{result.tree.activePathIds.includes(node.id) ? '当前路径 · ' : ''}{node.kind}</small><span>{node.label || node.summary || node.id}{node.id === result.tree.activeLeafId ? '（当前位置）' : ''}</span></button>;
      })}</div>
      <label className="field">切换时的上下文摘要<select aria-label="上下文摘要方式" disabled={busy} value={summaryMode} onChange={(event) => setSummaryMode(event.target.value)}><option value="none">不生成摘要</option><option value="default">生成默认摘要</option><option value="custom">按要求生成摘要</option></select></label>
      {summaryMode === 'custom' && <label className="field">摘要要求<input aria-label="摘要要求" maxLength={10_000} disabled={busy} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button>{result.type === 'tree' && <button type="button" className="button secondary" disabled={busy || !value} onClick={() => void submit(true)}>从此处分叉</button>}<button className="button primary" disabled={busy || !value || (result.type === 'tree' && summaryMode === 'custom' && !instructions.trim())}>{busy ? '执行中…' : result.type === 'tree' ? '切换到此处' : '确认'}</button></div>
  </form></div>;
}
