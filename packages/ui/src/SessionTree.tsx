import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight } from 'lucide-react';
import { sessionKey, sessionTitle } from './api';
import { type SessionEntry, type SessionNode } from '@remote-pi/core/session-tree';

const timeLabel = (value: string) => { const minutes = (Date.now() - new Date(value).getTime()) / 60000; return !Number.isFinite(minutes) ? '' : minutes < 1 ? '刚刚' : minutes < 60 ? `${Math.floor(minutes)} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时` : `${Math.floor(minutes / 1440)} 天`; };

export function SessionTree({ nodes, activeKey, activeWorking, runningIds, unreadKeys, searching, onPick }: { nodes: SessionNode[]; activeKey: string; activeWorking: boolean; runningIds?: ReadonlySet<string>; unreadKeys: ReadonlySet<string>; searching: boolean; onPick: (entry: SessionEntry) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const root = useRef<HTMLUListElement>(null);
  const revealed = useRef(false);
  useLayoutEffect(() => {
    if (revealed.current || !activeKey) return;
    const ancestors = (entries: SessionNode[]): string[] | undefined => {
      for (const node of entries) {
        const key = sessionKey(node.session);
        if (key === activeKey) return [];
        const path = ancestors(node.children);
        if (path) return [key, ...path];
      }
      return undefined;
    };
    const path = ancestors(nodes);
    if (!path) return;
    if (path.some((key) => !expanded.has(key))) { setExpanded((previous) => new Set([...previous, ...path])); return; }
    const selected = root.current?.querySelector('[aria-current="page"]');
    if (selected) { selected.scrollIntoView({ block: 'center', inline: 'nearest' }); revealed.current = true; }
  }, [activeKey, nodes, expanded]);
  const render = (node: SessionNode, depth: number) => {
    const { workspace, session } = node; const key = sessionKey(session); const open = searching || expanded.has(key);
    const working = runningIds ? runningIds.has(session.id) : key === activeKey && activeWorking;
    const unread = !working && unreadKeys.has(key);
    return <li key={key} data-session-id={session.id} data-session-depth={depth} className={node.missingParent ? 'session-orphan' : undefined}>
      <div className={`conversation-tree-row ${node.contextOnly ? 'context-only' : ''}`}>
        <button className={`conversation-row ${activeKey === key ? 'selected' : ''}`} aria-current={activeKey === key ? 'page' : undefined} onClick={() => onPick(node)} title={`${sessionTitle(session)}\n${workspace.path}${node.missingParent ? '\n父会话不在当前项目中' : ''}`}>
          {depth > 0 || node.missingParent ? <CornerDownRight size={12} className="session-child-marker" aria-label={node.missingParent ? '父会话不可用' : '子会话'} /> : <span className="conversation-dot" />}
          <span className="conversation-title">{sessionTitle(session)}{(session.agentSubsession || session.archived || !workspace.isMain) && <small>{[session.agentSubsession ? 'Subagent' : '', session.archived ? '已归档' : '', !workspace.isMain ? workspace.label : ''].filter(Boolean).join(' · ')}</small>}</span>{(working || unread) && <span className={`session-status-dot ${working ? 'running' : 'unread'}`} role="img" aria-label={working ? '正在执行' : '已结束，未查看'} title={working ? '正在执行' : '已结束，点击查看'} />}<time>{timeLabel(session.modified)}</time>
        </button>
        {node.children.length > 0 && <button className="session-expand" aria-label={`${open ? '收起' : '展开'} ${sessionTitle(session)} 的子会话`} aria-expanded={open} onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>}
      </div>
      {node.children.length > 0 && open && <ul className="session-children" aria-label={`${sessionTitle(session)} 的子会话`}>{node.children.map((child) => render(child, depth + 1))}</ul>}
    </li>;
  };
  return <ul ref={root} className="session-tree">{nodes.map((node) => render(node, 0))}</ul>;
}
