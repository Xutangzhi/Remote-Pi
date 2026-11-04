import { getBridge } from './bridge';
import { createContext, isValidElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import { createFileReferenceChecker, fileLinkPath, remarkFileReferences } from './file-links';
export { fileLinkPath, remoteFilePath, filePreviewError } from './file-links';
import remarkGfm from 'remark-gfm';
import { Check, ChevronRight, Copy, Terminal, X } from 'lucide-react';
import type { AskRequest, SessionRef } from '@remote-pi/core/pi';
import { piRequest, sessionInput } from './api';
import type { ImagePart, ToolItem, TranscriptItem } from '@remote-pi/core/transcript';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setStatus('idle'); return () => clearTimeout(timer.current); }, [text]);
  const copy = async () => {
    clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(text); setStatus('copied'); }
    catch { setStatus('error'); }
    timer.current = setTimeout(() => setStatus('idle'), 2000);
  };
  return <span className="copy-control"><button type="button" className="icon-button" aria-label={label} title={label} onClick={() => void copy()}>{status === 'copied' ? <Check size={13} /> : <Copy size={13} />}</button><span className={`copy-feedback ${status === 'error' ? 'error' : ''}`} role="status">{status === 'copied' ? '已复制' : status === 'error' ? '复制失败，请重试' : ''}</span></span>;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ children?: string; className?: string }>(children) ? children : undefined;
  return <div className="code-block"><div className="code-block-toolbar"><span>{code?.props.className?.replace(/^language-/, '') || '代码'}</span><CopyButton text={(code?.props.children || '').replace(/\n$/, '')} label="复制代码" /></div><pre>{children}</pre></div>;
}

type FileLinks = { onOpenFile?: (path: string) => void; onCheckFile?: (path: string) => Promise<boolean> };
const FileLinkContext = createContext<FileLinks>({});

export function useFileReferenceChecker(projectId?: string, workspaceId?: string, workspacePath = '', directory = workspacePath) {
  return useMemo(() => createFileReferenceChecker((query) => piRequest<{ path: string }[]>('files.suggest', { projectId, workspaceId, query, scope: 'all' }), workspacePath, directory), [projectId, workspaceId, workspacePath, directory]);
}

const FileLink: Components['a'] = ({ href, children, node }) => {
  const { onOpenFile, onCheckFile } = useContext(FileLinkContext);
  const automatic = !!node?.properties['data-file-reference'];
  const [verified, setVerified] = useState<{ href: string; checker: FileLinks['onCheckFile'] }>();
  useEffect(() => {
    let active = true;
    setVerified(undefined);
    if (automatic && href && onCheckFile) void onCheckFile(href).then((exists) => { if (active && exists) setVerified({ href, checker: onCheckFile }); }).catch(() => {});
    return () => { active = false; };
  }, [automatic, href, onCheckFile]);
  if (automatic && (!verified || verified.href !== href || verified.checker !== onCheckFile)) return <>{children}</>;
  return <a href={href} title={href && onOpenFile && fileLinkPath(href) ? `预览远端文件：${href}` : undefined} onClick={(event) => { event.preventDefault(); if (!href) return; if (/^https?:\/\//i.test(href)) void getBridge().openLink(href); else if (onOpenFile && fileLinkPath(href)) onOpenFile(href); }}>{children}</a>;
};

export function RichText({ text, onOpenFile, onCheckFile }: { text: string } & FileLinks) {
  return <FileLinkContext.Provider value={{ onOpenFile, onCheckFile }}><div className="prose"><Markdown remarkPlugins={onOpenFile ? [remarkGfm, remarkFileReferences] : [remarkGfm]} urlTransform={(url) => onOpenFile && fileLinkPath(url) ? url : defaultUrlTransform(url)} components={{
    a: FileLink,
    img: ({ alt }) => <span className="muted">[图片：{alt || '外部图片'}]</span>,
    pre: CodeBlock,
  }}>{text}</Markdown></div></FileLinkContext.Provider>;
}

function ConversationImage({ image, session }: { image: ImagePart; session: SessionRef }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSrc(''); setError('');
    if (image.data && /^image\/(png|jpeg|gif|webp)$/.test(image.mimeType || '')) setSrc(`data:${image.mimeType};base64,${image.data}`);
    else if (image.mediaId) void piRequest<string>('session.media', { ...sessionInput(session), mediaId: image.mediaId }).then((value) => { if (active) setSrc(value); }).catch(() => { if (active) setError('图片加载失败'); });
    return () => { active = false; };
  }, [image.data, image.mediaId, image.mimeType, session.id, session.cwd]);
  return src ? <img className="conversation-image" src={src} alt="会话附件" onError={() => { setSrc(''); setError('图片加载失败'); }} /> : <span className="muted" role="status">{error || '加载图片…'}</span>;
}

function ToolCard({ tool, session, onError, allowAsk }: { allowAsk: boolean; tool: ToolItem; session: SessionRef; onError: (error: unknown) => void }) {
  return <div className={`tool-card ${tool.state}`} data-testid="tool-card"><details>
    <summary><span className="tool-state">{tool.state === 'running' ? <span className="spinner" /> : tool.state === 'error' ? <X size={13} /> : <Check size={13} />}</span><Terminal size={14} /><strong>{tool.name}</strong><code>{tool.summary || (tool.state === 'running' ? '正在执行…' : tool.state === 'error' ? '执行失败' : '执行完成')}</code><ChevronRight className="disclosure" size={14} /></summary>
    <div className="tool-body">{tool.args !== undefined && <><label>参数</label><pre>{typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}</pre></>}{tool.output && <><div className="tool-output-label"><label>输出</label><CopyButton text={tool.output} label="复制输出" /></div><pre>{tool.output}</pre></>}{typeof tool.details?.diff === 'string' && <pre className="code-diff">{tool.details.diff}</pre>}{tool.images?.map((image, index) => <ConversationImage key={index} image={image} session={session} />)}</div>
  </details>{tool.ask && (allowAsk ? <AskForm request={tool.ask} session={session} onError={onError} /> : <div className="ask-form muted">{tool.ask.questions.map((question) => <p key={question.id}>{question.question}</p>)}历史提问</div>)}</div>;
}

function AskForm({ request, session, onError }: { request: AskRequest; session: SessionRef; onError: (error: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<'submitted' | 'cancelled'>();
  const [busy, setBusy] = useState(false);
  const submit = async (cancel = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await piRequest('session.ask', { ...sessionInput(session), askId: request.askId, ...(cancel ? { cancel: true } : {
        answers: request.questions.map((question) => {
          const otherText = other[question.id]?.trim();
          return { id: question.id, values: otherText && !question.multiple ? [] : answers[question.id] || [], ...(otherText ? { otherText } : {}) };
        }),
      }) });
      setSent(cancel ? 'cancelled' : 'submitted');
    }
    catch (error) { onError(error); } finally { setBusy(false); }
  };
  if (sent) return <div className="ask-form muted">{sent === 'cancelled' ? '已取消回答' : '回答已提交'}</div>;
  return <form className="ask-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>{request.questions.map((question) => <fieldset key={question.id} disabled={busy}><legend>{question.question}</legend>{question.detail && <p>{question.detail}</p>}{question.options.map((option) => <label className="ask-option" key={option.value}>
    <input type={question.multiple ? 'checkbox' : 'radio'} name={`${request.askId}:${question.id}`} checked={answers[question.id]?.includes(option.value) || false}
      onClick={() => { if (!question.multiple && answers[question.id]?.includes(option.value)) setAnswers((previous) => ({ ...previous, [question.id]: [] })); }}
      onChange={(event) => {
        const checked = event.target.checked;
        setAnswers((previous) => ({ ...previous, [question.id]: question.multiple ? checked ? [...previous[question.id] || [], option.value] : (previous[question.id] || []).filter((value) => value !== option.value) : [option.value] }));
        if (!question.multiple) setOther((previous) => ({ ...previous, [question.id]: '' }));
      }} />
    <span>{option.label}{option.detail && <small>{option.detail}</small>}</span>
  </label>)}<input placeholder={question.multiple ? '补充回答…' : '或输入自定义回答…'} aria-label={`${question.question} 补充回答`} maxLength={4000} value={other[question.id] || ''} onChange={(event) => {
    const value = event.target.value;
    setOther((previous) => ({ ...previous, [question.id]: value }));
    if (!question.multiple && value.trim()) setAnswers((previous) => ({ ...previous, [question.id]: [] }));
  }} /></fieldset>)}<div className="dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => void submit(true)}>取消</button><button className="button primary" disabled={busy || !request.questions.every((question) => answers[question.id]?.length || other[question.id]?.trim())}>提交回答</button></div></form>;
}

export function Transcript({ items, session, onError, onOpenFile, onCheckFile }: { items: TranscriptItem[]; session: SessionRef; onError: (error: unknown) => void } & FileLinks) {
  return <>{items.map((item, index) => item.kind === 'tool' ? <ToolCard key={item.id} allowAsk={index === items.length - 1} tool={item} session={session} onError={onError} /> : (item.text || item.thinking || item.images.length) ? <article key={item.id} className={`message message-${item.role}`} data-testid={`message-${item.role}`}>
    {item.role === 'assistant' && <div className="assistant-label"><span className="pi-glyph">π</span>Pi<span>{item.model}</span></div>}
    {item.thinking && <details className="thinking"><summary><ChevronRight size={13} />思考过程</summary><RichText text={item.thinking} onOpenFile={onOpenFile} onCheckFile={onCheckFile} /></details>}
    <div className="message-content"><RichText text={item.text} onOpenFile={onOpenFile} onCheckFile={onCheckFile} />{item.images.map((image, index) => <ConversationImage key={index} image={image} session={session} />)}</div>
    {item.text && !item.live && <div className="message-actions"><CopyButton text={item.text} label={item.role === 'assistant' ? '复制回复' : '复制消息'} /></div>}
  </article> : null)}</>;
}
