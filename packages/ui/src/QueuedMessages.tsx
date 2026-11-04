import { useRef, useState } from 'react';
import type { QueuedMessage, SessionRef, SessionStatus } from '@remote-pi/core/pi';
import { piRequest, sessionInput } from './api';

export function QueuedMessages({ session, status, disabled, hasDraft, onPending, onUpdate, onRecall }: {
  session: SessionRef; status: SessionStatus; disabled: boolean; hasDraft: boolean;
  onPending: (pending: boolean) => void; onUpdate: (status: SessionStatus) => void; onRecall: (message: QueuedMessage) => void;
}) {
  const pending = useRef(false);
  const [error, setError] = useState('');
  const messages = status.queuedMessages || [];
  const unavailable = status.queueMessageActionsUnavailable;
  const remove = async (index: number, recall: boolean) => {
    const message = messages[index];
    if (!message || disabled || pending.current || unavailable !== undefined || (recall && (hasDraft || message.hasAttachments || message.attachmentCount))) return;
    pending.current = true; onPending(true); setError('');
    try {
      // Remove only this entry. The server's "edit" action also removes later entries.
      const next = await piRequest<SessionStatus>('session.queue.remove', { ...sessionInput(session), index, expectedQueue: messages });
      if (recall) onRecall(message);
      onUpdate(next);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      setError(detail.includes('Queued messages changed') ? '队列已变化，消息可能已开始处理。请根据最新队列重试。' : `操作失败：${detail}`);
    } finally { pending.current = false; onPending(false); }
  };
  if (status.sessionId !== session.id || (!messages.length && !error)) return null;
  return <div className="queued-messages" aria-label="待处理消息">
    {unavailable !== undefined && <small role="status">{unavailable || '当前远端版本不支持修改排队消息。'}</small>}
    {messages.map((message, index) => {
      const attached = message.hasAttachments || Boolean(message.attachmentCount);
      const recallReason = attached ? '远端未返回附件内容，无法完整取回编辑；可以取消此消息。' : hasDraft ? '输入框已有草稿，请先发送或清空后再撤回编辑。' : '仅撤回此消息到输入框，修改后重新发送';
      return <div className="queued-message-row" key={index}>
        <span title={message.text}>{message.kind === 'steer' ? '引导' : '排队'}：{message.text}{attached ? '（含附件）' : ''}</span>
        <button type="button" disabled={disabled || unavailable !== undefined || hasDraft || attached} title={recallReason} onClick={() => void remove(index, true)}>撤回编辑</button>
        <button type="button" disabled={disabled || unavailable !== undefined} title="仅取消此消息，保留其他排队消息" onClick={() => void remove(index, false)}>取消</button>
      </div>;
    })}
    {hasDraft && messages.length > 0 && <small>输入框已有草稿，发送或清空后可撤回编辑。</small>}
    {messages.some((message) => message.hasAttachments || message.attachmentCount) && <small>含附件的消息可取消；远端未返回附件内容，暂不能完整取回编辑。</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
