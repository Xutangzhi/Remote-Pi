import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Archive, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, GitBranch, ImagePlus, MessageSquare, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRight, Plus, RefreshCw, Search, Server, Settings2, Square, Sun, Terminal, Undo2, X } from 'lucide-react';
import type { Attachment, CommandResult, ExtensionDialog, MessagePage, Model, Project, SessionInfo, SessionStatus, Workspace as RemoteWorkspace } from '../../shared/pi';
import type { ServerProfile, Theme } from '../../shared/types';
import { isWorking, piRequest, sessionInput, sessionKey, sessionTitle } from './api';
import { applyEvent, fromSnapshot, prependHistory, type TranscriptState } from './transcript';
import { Transcript } from './ChatTranscript';
import { Inspector, type Panel } from './Inspector';
import { ResizeHandle } from './ResizeHandle';
import { useDialogFocus } from './useDialogFocus';
import { useSessionIndicators } from './useSessionIndicators';
import { SessionTree } from './SessionTree';
import { PromptInput } from './PromptInput';
import { CommandDialog, type PendingCommand } from './CommandDialog';
import { buildSessionTree, filterSessionTree } from './session-tree';
import './workspace.css';

type ProjectGroup = { project: Project; workspaces: { workspace: RemoteWorkspace; sessions: SessionInfo[] }[] };
type Selection = { project: Project; workspace: RemoteWorkspace; session: SessionInfo };
type PaneSizes = Partial<Record<'left' | 'right' | 'bottom', number>>;
const paneSizesKey = 'remote-pi.pane-sizes';
const clampSize = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
type Draft = { text: string; attachments: Attachment[] };
const drafts = new Map<string, Draft>();
const lastSessions = new Map<string, string>();
const inputHistories = new Map<string, string[]>();
const previousInputs = (state: TranscriptState) => state.items.flatMap((item) => item.kind === 'message' && item.role === 'user' && item.text.trim() ? [item.text] : []);
const emptyDraft = (): Draft => ({ text: '', attachments: [] });
const readLocal = (key: string) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const getDraft = (key: string): Draft => {
  if (!drafts.has(key)) drafts.set(key, { text: readLocal(`remote-pi.draft.${key}`), attachments: [] });
  return drafts.get(key)!;
};
const reasonText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const thinkingLabels: Record<string, string> = { off: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高' };


export function Workspace({ profile, theme, onManage, onTheme, onDisconnect }: { profile?: ServerProfile; theme: Theme; onManage: () => void; onTheme: () => void; onDisconnect: () => void }) {
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [selection, setSelection] = useState<Selection>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [sidebar, setSidebar] = useState<false | 'docked'>(() => window.matchMedia('(max-width: 839px)').matches ? false : 'docked');
  const [mountedSidebar, setMountedSidebar] = useState<false | 'docked'>(false);
  const [sidebarReveal, setSidebarReveal] = useState(0);
  const displayedSidebar = sidebar || mountedSidebar;
  const [paneSizes, setPaneSizes] = useState<PaneSizes>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(paneSizesKey) || '{}');
      return Object.fromEntries(['left', 'right', 'bottom'].filter((key) => typeof saved?.[key] === 'number' && Number.isFinite(saved[key])).map((key) => [key, saved[key]]));
    } catch { return {}; }
  });
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const phone = viewport.width < 840;
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { try { localStorage.setItem(paneSizesKey, JSON.stringify(paneSizes)); } catch {} }, [paneSizes]);
  const setPaneSize = (key: keyof PaneSizes, value?: number) => setPaneSizes((previous) => ({ ...previous, [key]: value }));
  const [panel, setPanel] = useState<Panel>();
  const [mountedPanel, setMountedPanel] = useState<Panel>();
  const [dialog, setDialog] = useState<'project' | 'session' | 'rename'>();
  const [newProjectId, setNewProjectId] = useState('');
  const [menu, setMenu] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [error, setError] = useState('');
  const [command, setCommand] = useState<PendingCommand>();
  const [commandNotice, setCommandNotice] = useState<{ key: string; message: string }>();
  const [transcript, setTranscript] = useState<TranscriptState>({ items: [] });
  const [status, setStatus] = useState<SessionStatus>();
  const [loadedKey, setLoadedKey] = useState('');
  const [focused, setFocused] = useState(() => document.hasFocus() && document.visibilityState === 'visible');
  const [viewVersion, setViewVersion] = useState(0);
  const [stream, setStream] = useState('connecting');
  const [start, setStart] = useState(0);
  const [olderLoading, setOlderLoading] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [sendingKeys, setSendingKeys] = useState<Set<string>>(new Set());
  const [behavior, setBehavior] = useState('followUp');
  const [nearBottom, setNearBottom] = useState(true);
  const [retry, setRetry] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const panelWorkspace = useRef<string | undefined>(undefined);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const generation = useRef(0);
  const stick = useRef(true);
  const preserveScroll = useRef<number | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const report = useCallback((reason: unknown) => setError(reasonText(reason)), []);
  const indicators = useSessionIndicators(report);
  const draftKey = selection ? `${profile?.id}:${sessionKey(selection.session)}` : '';
  const activeKey = selection ? sessionKey(selection.session) : '';
  const sending = sendingKeys.has(draftKey);
  const working = isWorking(status);
  const sidebarActivity = indicators.unreadKeys.size ? 'unread' : (indicators.running?.size || (!indicators.running && working)) ? 'running' : undefined;
  const sidebarDot = sidebarActivity && <span className={`sidebar-status-dot session-status-dot ${sidebarActivity}`} role="img" aria-label={sidebarActivity === 'unread' ? '有已完成未读对话' : '有对话正在执行'} />;
  const openSidebar = () => {
    if (phone) { textarea.current?.blur(); setPanel(undefined); }
    const current = selectionRef.current;
    setSearch(''); setArchived(Boolean(current?.session.archived));
    if (current) setCollapsed((previous) => { const next = new Set(previous); next.delete(current.project.id); return next; });
    setSidebarReveal((version) => version + 1);
    setSidebar('docked');
  };
  useLayoutEffect(() => {
    if (sidebar) { setMountedSidebar(sidebar); return; }
    if (!mountedSidebar) return;
    // Keep the exiting surface mounted until the 420 ms slide has finished.
    const timer = setTimeout(() => setMountedSidebar(false), 440);
    return () => clearTimeout(timer);
  }, [sidebar, mountedSidebar]);
  useLayoutEffect(() => {
    if (panel) { panelWorkspace.current = selection?.workspace.id; setMountedPanel(panel); return; }
    if (!mountedPanel) return;
    const timer = setTimeout(() => setMountedPanel(undefined), 440);
    return () => clearTimeout(timer);
  }, [panel, mountedPanel, selection?.workspace.id]);
  useEffect(() => {
    const back = (event: Event) => {
      // Dialogs own Back, including while busy. Do not consume it before their listener.
      if (event.defaultPrevented || dialog || (command && sessionKey(command.session) === activeKey)) return;
      if (menu) { event.preventDefault(); setMenu(false); }
      else if (panel) { event.preventDefault(); setPanel(undefined); }
      else if (phone && sidebar) { event.preventDefault(); setSidebar(false); }
    };
    window.addEventListener('remote-pi:back', back);
    return () => window.removeEventListener('remote-pi:back', back);
  }, [menu, dialog, command, activeKey, panel, phone, sidebar]);
  useEffect(() => { if (phone) setSidebar(false); }, [phone]);

  const pick = useCallback((value: Selection) => { selectionRef.current = value; lastSessions.set(profile?.id || '', sessionKey(value.session)); try { localStorage.setItem(`remote-pi.last-session.${profile?.id || ''}`, sessionKey(value.session)); } catch {} setSelection(value); if (window.matchMedia('(max-width: 839px)').matches) setSidebar(false); setViewVersion((previous) => previous + 1); setMenu(false); setCommand(undefined); setError(''); }, [profile?.id]);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try {
      const projects = await piRequest<Project[]>('projects.list');
      const next = await Promise.all(projects.map(async (project) => {
        const result = await piRequest<{ workspaces: RemoteWorkspace[] }>('workspaces.list', { projectId: project.id });
        return { project, workspaces: await Promise.all(result.workspaces.map(async (workspace) => ({ workspace, sessions: await piRequest<SessionInfo[]>('sessions.list', { cwd: workspace.path }) }))) };
      }));
      if (generation.current !== version) return;
      setGroups(next);
      const entries = next.flatMap(({ project, workspaces }) => workspaces.flatMap(({ workspace, sessions }) => sessions.map((session) => ({ project, workspace, session }))));
      const current = selectionRef.current;
      const found = entries.find((entry) => sessionKey(entry.session) === (current ? sessionKey(current.session) : (lastSessions.get(profile?.id || '') || readLocal(`remote-pi.last-session.${profile?.id || ''}`))));
      if (found) setSelection(found);
      else if (!current) { const candidates = entries.filter((entry) => !entry.session.archived).sort((a, b) => b.session.modified.localeCompare(a.session.modified)); const first = candidates.find((entry) => !entry.session.parentSessionPath && !entry.session.agentSubsession) || candidates[0]; if (first) pick(first); }
    } catch (reason) { if (generation.current === version) report(reason); }
    finally { if (generation.current === version) setCatalogLoading(false); }
  }, [profile?.id, pick, report]);
  useEffect(() => { void refresh(); return () => { generation.current++; clearTimeout(refreshTimer.current); }; }, [refresh]);
  useEffect(() => window.desktop.onWorkspaceRefresh(() => { void refresh(); setRetry((value) => value + 1); }), [refresh]);
  useEffect(() => window.desktop.onWorkspace((packet) => {
    if (packet.type !== 'catalog') return;
    const event = packet.event;
    if (['catalog.connected', 'session.created', 'session.name', 'session.archived', 'session.restored', 'workspaces.changed', 'session.tree.changed'].includes(event.type)) {
      clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => void refresh(), 250);
    }
  }), [refresh]);

  useEffect(() => {
    if (!selection) return;
    const session = selection.session;
    const id = crypto.randomUUID(); let active = true;
    setLoadedKey(''); setTranscript({ items: [] }); setStatus(undefined); setStream('connecting'); setStart(0); setModels([]); setLevels([]); setOlderLoading(false); preserveScroll.current = null; stick.current = true; setNearBottom(true);
    const off = window.desktop.onWorkspace((packet) => {
      if (packet.type === 'catalog' || packet.subscriptionId !== id) return;
      if (packet.type === 'snapshot') { setLoadedKey(sessionKey(session)); setTranscript(fromSnapshot(packet.snapshot)); setStart(packet.snapshot.page.start); setStatus(packet.snapshot.status); }
      if (packet.type === 'stream') { setStream(packet.state); if (packet.message) report(packet.message); }
      if (packet.type === 'event') {
        const event = packet.event; setTranscript((previous) => applyEvent(previous, event));
        if (event.status) setStatus(event.status);
        if (event.type === 'agent.start') setStatus((previous) => previous && ({ ...previous, isStreaming: true }));
        if (event.type === 'agent.end') { setStatus((previous) => previous && ({ ...previous, isStreaming: false, isCompacting: false, isBashRunning: false })); clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => void refresh(), 250); }
        if (event.type === 'session.tree.changed') setRetry((value) => value + 1);
        if (event.type === 'dialog.opened' && event.dialog) setStatus((previous) => previous && ({ ...previous, pendingDialogs: [...(previous.pendingDialogs || []).filter((item) => item.dialogId !== event.dialog!.dialogId), event.dialog!] }));
        if (event.type === 'dialog.closed') setStatus((previous) => previous && ({ ...previous, pendingDialogs: previous.pendingDialogs?.filter((item) => item.dialogId !== event.dialogId) }));
      }
    });
    void window.desktop.watchSession({ id: session.id, cwd: session.cwd }, id).catch((reason) => { if (active) { report(reason); setStream('error'); } });
    void piRequest<{ models: Model[] }>('session.models', sessionInput(session)).then((result) => { if (active) setModels(result.models); }).catch((reason) => { if (active) report(reason); });
    void piRequest<{ levels: string[] }>('session.thinkingLevels', sessionInput(session)).then((result) => { if (active) setLevels(result.levels); }).catch((reason) => { if (active) report(reason); });
    return () => { active = false; off(); void window.desktop.unwatchSession(id); };
  }, [activeKey, retry, refresh, report]);

  useEffect(() => {
    const updateFocus = () => setFocused(document.hasFocus() && document.visibilityState === 'visible');
    window.addEventListener('focus', updateFocus); window.addEventListener('blur', updateFocus); document.addEventListener('visibilitychange', updateFocus);
    return () => { window.removeEventListener('focus', updateFocus); window.removeEventListener('blur', updateFocus); document.removeEventListener('visibilitychange', updateFocus); };
  }, []);
  useEffect(() => {
    if (selection && loadedKey === activeKey && stream === 'live' && !working && focused && !(phone && (sidebar || panel)) && !menu && !dialog && !(command && sessionKey(command.session) === activeKey) && !status?.pendingDialogs?.length) void indicators.acknowledge(selection.session);
  }, [activeKey, loadedKey, stream, working, focused, phone, sidebar, panel, menu, dialog, command, status?.pendingDialogs?.length, indicators.unread, indicators.acknowledge, viewVersion]);

  useEffect(() => { setDraft(getDraft(draftKey)); }, [draftKey]);
  const storeDraft = (key: string, value: Draft) => {
    drafts.set(key, value);
    try {
      if (value.text) localStorage.setItem(`remote-pi.draft.${key}`, value.text);
      else localStorage.removeItem(`remote-pi.draft.${key}`);
    } catch { report('文字草稿暂时无法保存到本机，请在关闭应用前复制保留。'); }
  };
  const editDraft = (value: Draft) => { storeDraft(draftKey, value); setDraft(value); };
  useLayoutEffect(() => {
    const element = scroll.current; const content = element?.firstElementChild;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      if (stick.current && preserveScroll.current === null) element.scrollTop = element.scrollHeight;
      setNearBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 100);
    });
    observer.observe(element); observer.observe(content);
    return () => observer.disconnect();
  }, [activeKey]);
  useLayoutEffect(() => {
    const element = scroll.current; if (!element) return;
    if (preserveScroll.current !== null) { element.scrollTop += element.scrollHeight - preserveScroll.current; preserveScroll.current = null; }
    else if (stick.current) element.scrollTop = element.scrollHeight;
  }, [transcript, status, activeKey]);
  const jumpToBottom = () => { stick.current = true; setNearBottom(true); scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };

  const changeSessionSetting = async (operation: 'session.model' | 'session.thinking', input: Record<string, unknown>) => {
    if (!selection) return;
    const key = activeKey;
    try { const next = await piRequest<SessionStatus>(operation, { ...sessionInput(selection.session), ...input }); if (selectionRef.current && sessionKey(selectionRef.current.session) === key) setStatus(next); }
    catch (reason) { report(reason); }
  };
  const applyCommandResult = (owner: Selection, result: CommandResult, reload = false) => {
    if (result.type === 'unsupported') throw new Error(result.message);
    if (!selectionRef.current || sessionKey(selectionRef.current.session) !== sessionKey(owner.session)) return;
    setCommand(undefined);
    if (result.type === 'select' || result.type === 'tree') { setCommand({ session: owner.session, result }); return; }
    if (result.message) setCommandNotice({ key: sessionKey(result.session || owner.session), message: result.message });
    if (result.session) {
      const group = groups.find((item) => item.workspaces.some((entry) => entry.workspace.path === result.session!.cwd));
      const workspace = group?.workspaces.find((entry) => entry.workspace.path === result.session!.cwd)?.workspace;
      if (!group || !workspace) throw new Error('命令返回的会话不在已加载的工作区中，请刷新项目。');
      if (result.promptDraft !== undefined) {
        const key = `${profile?.id}:${sessionKey(result.session)}`;
        const next = { text: result.promptDraft, attachments: [] };
        storeDraft(key, next); if (sessionKey(result.session) === activeKey) setDraft(next);
      }
      pick({ project: group.project, workspace, session: result.session });
    }
    if (reload) setRetry((value) => value + 1);
    void refresh();
  };
  const send = async () => {
    if (!selection || sending || stream !== 'live' || (!draft.text.trim() && !draft.attachments.length)) return;
    const current = selection; const key = draftKey; const submitted = draft; const submitFocus = document.activeElement;
    const history = inputHistories.get(key) || previousInputs(transcript);
    setSendingKeys((previous) => new Set(previous).add(key)); setError(''); setCommand(undefined);
    try {
      const text = submitted.text.trim();
      setCommandNotice(undefined);
      if (!submitted.attachments.length && text.startsWith('/')) {
        if (text === '/new') newSession(current.project.id);
        else if (text === '/model') setCommand({ session: current.session, local: 'model', result: { type: 'select', requestId: 'model', title: '选择模型', options: allModels.filter((model) => model.provider && model.id).map((model) => ({ value: `${model.provider}\0${model.id}`, label: model.name || model.id!, description: model.provider })) } });
        else if (text === '/resume') setCommand({ session: current.session, local: 'resume', result: { type: 'select', requestId: 'resume', title: '切换会话', options: groups.flatMap((group) => group.workspaces.flatMap((entry) => entry.sessions.filter((session) => !session.archived).map((session) => ({ value: sessionKey(session), label: sessionTitle(session), description: group.project.name })))) } });
        else {
          const result = await piRequest<CommandResult>('session.command', { ...sessionInput(current.session), text });
          // Keep an interactive command in its original draft if the user has moved away.
          if ((result.type === 'select' || result.type === 'tree') && sessionKey(selectionRef.current?.session || { id: '', cwd: '' }) !== sessionKey(current.session)) return;
          applyCommandResult(current, result, text === '/reload');
        }
      } else if (!submitted.attachments.length && text.startsWith('!')) await piRequest('session.shell', { ...sessionInput(current.session), text });
      else await piRequest('session.prompt', { ...sessionInput(current.session), text: submitted.text, ...(submitted.attachments.length ? { attachments: submitted.attachments } : {}), ...(working ? { streamingBehavior: behavior } : {}) });
      if (submitted.text.trim() && history.at(-1) !== submitted.text) inputHistories.set(key, [...history, submitted.text]);
      // A command can restore a draft, or image reads can finish while sending.
      // Only consume the exact draft that this request submitted.
      if (drafts.get(key) === submitted) {
        const cleared = emptyDraft(); storeDraft(key, cleared);
        if (selectionRef.current && sessionKey(selectionRef.current.session) === sessionKey(current.session)) { setDraft(cleared); jumpToBottom(); requestAnimationFrame(() => { if (selectionRef.current && sessionKey(selectionRef.current.session) === sessionKey(current.session) && (document.activeElement === submitFocus || (submitFocus === textarea.current && document.activeElement === document.body))) textarea.current?.focus(); }); }
      }
      void refresh();
    } catch (reason) { if (selectionRef.current && sessionKey(selectionRef.current.session) === sessionKey(current.session)) report(reason); } finally { setSendingKeys((previous) => { const next = new Set(previous); next.delete(key); return next; }); }
  };
  const readImages = async (files: File[]) => {
    const key = draftKey;
    try {
      const result = await Promise.all(files.map(async (file): Promise<Attachment> => {
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('支持 PNG、JPEG、GIF 和 WebP 图片。');
        if (file.size > 10 * 1024 * 1024) throw new Error('每张图片不能超过 10 MB。');
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(file); });
        return { kind: 'image', mimeType: file.type, data, name: file.name };
      }));
      const previous = getDraft(key); const next = { ...previous, attachments: [...previous.attachments, ...result] }; storeDraft(key, next);
      if (selectionRef.current && `${profile?.id}:${sessionKey(selectionRef.current.session)}` === key) setDraft(next);
    } catch (reason) { report(reason); }
  };
  const loadOlder = async () => {
    if (!selection || !start || olderLoading) return;
    const session = selection.session; setOlderLoading(true);
    try {
      const page = await piRequest<MessagePage>('session.messages', { ...sessionInput(session), before: start });
      if (!selectionRef.current || sessionKey(selectionRef.current.session) !== sessionKey(session)) return;
      const key = `${profile?.id}:${sessionKey(session)}`;
      const history = inputHistories.get(key);
      if (history) inputHistories.set(key, [...previousInputs(prependHistory({ items: [] }, page.messages, page.start)), ...history]);
      preserveScroll.current = scroll.current?.scrollHeight || 0; setTranscript((previous) => prependHistory(previous, page.messages, page.start)); setStart(page.start);
    } catch (reason) { report(reason); } finally { if (selectionRef.current && sessionKey(selectionRef.current.session) === sessionKey(session)) setOlderLoading(false); }
  };
  const archiveSession = async () => {
    if (!selection) return;
    try { await piRequest(selection.session.archived ? 'session.restore' : 'session.archive', sessionInput(selection.session)); setMenu(false); await refresh(); }
    catch (reason) { report(reason); }
  };
  const newSession = (projectId?: string) => { if (phone) setSidebar(false); setNewProjectId(projectId || selection?.project.id || groups[0]?.project.id || ''); setDialog(groups.length ? 'session' : 'project'); };
  const togglePanel = (value: Panel) => { if (phone) { textarea.current?.blur(); setSidebar(false); } setPanel((previous) => previous === value ? undefined : value); };
  const selectedModel = status?.model?.provider && status.model.id ? `${status.model.provider}\0${status.model.id}` : '';
  const allModels = models.some((model) => `${model.provider}\0${model.id}` === selectedModel) || !status?.model ? models : [status.model, ...models];

  const displayedPanel = panel || (panelWorkspace.current === selection?.workspace.id ? mountedPanel : undefined);
  const stackedPanel = viewport.width <= 1200;
  const leftMax = phone ? Math.min(340, viewport.width * .88) : Math.min(480, viewport.width - 320 - (!stackedPanel && displayedPanel ? 280 : 0));
  const leftWidth = phone ? leftMax : clampSize(paneSizes.left ?? 258, 180, leftMax);
  const rightMax = Math.min(800, viewport.width - (displayedSidebar === 'docked' ? leftWidth : 0) - 320);
  const rightWidth = clampSize(paneSizes.right ?? (displayedPanel === 'terminal' ? 500 : 420), 280, rightMax);
  const bottomMax = Math.max(160, viewport.height - 320);
  const bottomHeight = clampSize(paneSizes.bottom ?? Math.min(420, viewport.height * .36), 160, bottomMax);
  return <div style={{ '--sidebar-width': `${leftWidth}px`, '--panel-width': `${rightWidth}px`, '--panel-height': `${bottomHeight}px` } as CSSProperties} className={`pi-workspace ${resizing ? 'panes-resizing' : ''} ${selection && displayedPanel ? 'has-inspector' : ''} ${displayedSidebar === 'docked' ? '' : 'sidebar-hidden'}  ${displayedSidebar && !sidebar ? 'sidebar-exiting' : ''}`}>
    {phone && displayedSidebar && <button className={`mobile-sidebar-shade ${!sidebar ? 'is-closing' : ''}`} aria-label="关闭侧栏" aria-hidden={!sidebar} tabIndex={sidebar ? undefined : -1} onClick={() => setSidebar(false)} />}
    {displayedSidebar && <aside className="project-sidebar" inert={!sidebar} aria-hidden={!sidebar}><div className="sidebar-surface"><div className="workspace-brand"><span className="pi-glyph">π</span><strong>Remote Pi</strong><button className="icon-button sidebar-toggle" title="收起侧栏" aria-label="收起侧栏" onClick={() => setSidebar(false)}><PanelLeftClose size={16} />{sidebarDot}</button></div>
      <button className="new-chat" onClick={() => newSession()}><FilePlus2 size={17} /><span>新建对话</span><kbd>⌘ N</kbd></button>
      <label className="sidebar-search"><Search size={14} /><input aria-label="搜索项目和对话" placeholder="搜索项目和对话" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="清除搜索" onClick={() => setSearch('')}><X size={13} /></button>}</label>
      <div className="project-section-heading"><span>{archived ? '已归档' : '项目'}</span><div><button className={`icon-button ${archived ? 'active' : ''}`} title={archived ? '查看活跃对话' : '查看归档对话'} aria-label="切换归档对话" onClick={() => setArchived(!archived)}><Archive size={14} /></button><button className="icon-button" title="添加项目" aria-label="添加项目" onClick={() => setDialog('project')}><Plus size={16} /></button></div></div>
      <nav className="project-tree" aria-label="项目与对话">{catalogLoading && <div className="sidebar-empty"><span className="spinner" />正在读取远端项目…</div>}{!catalogLoading && !groups.length && <div className="sidebar-empty">添加一个远端目录，<br />开始你的第一个项目。<button onClick={() => setDialog('project')}><Plus size={14} />添加项目</button></div>}
        {groups.map(({ project, workspaces }) => {
          const matchesProject = `${project.name} ${project.path}`.toLowerCase().includes(search.toLowerCase());
          const tree = buildSessionTree(workspaces.flatMap(({ workspace, sessions }) => sessions.map((session) => ({ workspace, session }))));
          const nodes = filterSessionTree(tree, archived, search, matchesProject);
          if (search && !matchesProject && !nodes.length) return null;
          const open = Boolean(search) || !collapsed.has(project.id);
          return <section className="project-group" key={project.id}><div className="project-row"><button className="project-toggle" title={project.path} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; })}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Folder size={15} /><strong>{project.name}</strong></button><button className="icon-button project-new" aria-label={`在 ${project.name} 新建对话`} onClick={() => newSession(project.id)}><Plus size={14} /></button></div>
            {open && <div className="project-conversations"><SessionTree key={sidebarReveal} nodes={nodes} activeKey={activeKey} runningIds={indicators.running} activeWorking={working} unreadKeys={indicators.unreadKeys} searching={Boolean(search.trim())} onPick={({ workspace, session }) => pick({ project, workspace, session })} />{!nodes.length && <span className="no-conversations">{archived ? '暂无归档' : '暂无对话'}</span>}</div>}
          </section>;
        })}</nav>
      <div className="workspace-sidebar-bottom"><button className="server-switch" disabled={sendingKeys.size > 0} title={sendingKeys.size > 0 ? '正在提交消息或命令，完成后可切换服务器设置' : '服务器设置'} onClick={onManage}><span className="server-square"><Server size={16} /><i /></span><span><strong>{profile?.name || 'SSH 服务器'}</strong><small>{profile?.username ? `${profile.username}@` : ''}{profile?.host}</small></span><Settings2 size={15} /></button><div className="sidebar-utilities"><button aria-label="切换主题" title="切换主题" onClick={onTheme}>{theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}</button><button aria-label="刷新项目" title="刷新项目" onClick={() => { void refresh(); indicators.refresh(); setRetry((value) => value + 1); }}><RefreshCw size={14} /></button></div></div>
    </div>{!phone && <ResizeHandle label="调整左侧栏宽度" direction={1} value={leftWidth} min={180} max={leftMax} onChange={(value) => setPaneSize('left', value)} onReset={() => setPaneSize('left')} onDragging={setResizing} />}</aside>}
    <main className="conversation-main"><header className="conversation-header"><div className="conversation-heading">{(!sidebar || phone) && <button className="icon-button sidebar-toggle" aria-label="展开侧栏" onClick={() => openSidebar()}><PanelLeftOpen size={17} />{sidebarDot}</button>}<div className="conversation-breadcrumb"><span>{selection?.project.name || '工作台'}</span>{selection && <><ChevronRight size={12} /><strong>{sessionTitle(selection.session)}</strong></>}</div>{selection && <span className="branch-label" title={selection.workspace.path}><GitBranch size={12} />{selection.workspace.label}</span>}</div><div className="conversation-actions">{selection && <><button className={`icon-button ${panel === 'files' ? 'active' : ''}`} aria-label="文件面板" title="工作区工具" onClick={() => togglePanel('files')}><PanelRight size={17} /></button><button className={`icon-button desktop-panel-button ${panel === 'diff' ? 'active' : ''}`} aria-label="变更面板" title="变更" onClick={() => togglePanel('diff')}><GitBranch size={17} /></button><button className={`icon-button desktop-panel-button ${panel === 'terminal' ? 'active' : ''}`} aria-label="终端面板" title="终端" onClick={() => togglePanel('terminal')}><Terminal size={17} /></button><span className="toolbar-divider" /><div className="conversation-menu"><button className="icon-button" aria-label="对话菜单" onClick={() => setMenu(!menu)}><MoreHorizontal size={19} /></button>{menu && <><div className="menu-dismiss" onClick={() => setMenu(false)} /><div className="popover-menu"><button onClick={() => { setDialog('rename'); setMenu(false); }}>重命名对话</button><button disabled={working} onClick={() => void archiveSession()}>{selection.session.archived ? <Undo2 size={14} /> : <Archive size={14} />}{selection.session.archived ? '恢复对话' : '归档对话'}</button><button onClick={onDisconnect}>断开服务器</button></div></>}</div></>}</div></header>
      {error && <div className="workspace-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}
      {selection ? <><div className="transcript-scroll" ref={scroll} onScroll={() => { const element = scroll.current!; const near = element.scrollHeight - element.scrollTop - element.clientHeight < 100; stick.current = near; setNearBottom(near); }}><div className="transcript-column">
        <div className="conversation-intro"><span><MessageSquare size={14} />{selection.workspace.path}</span><h1>{sessionTitle(selection.session)}</h1></div>
        {start > 0 && <button className="load-history" disabled={olderLoading} onClick={() => void loadOlder()}>{olderLoading ? '加载中…' : '加载更早的消息'}</button>}
        {stream === 'connecting' && !transcript.items.length ? <div className="transcript-loading"><span className="spinner" />正在读取对话…</div> : !transcript.items.length && stream === 'live' ? <div className="empty-conversation"><span className="pi-glyph">π</span><h2>从一个想法开始。</h2><p>描述你想完成的工作，Pi 会在此目录中执行。</p></div> : null}
        <Transcript items={transcript.items} session={selection.session} onError={report} />
        {working && <div className="working-status"><span className="spinner" />{status?.isCompacting ? '正在整理上下文' : status?.isBashRunning ? '正在执行命令' : 'Pi 正在工作'}<span>远端运行中</span></div>}
      </div></div>
      <div className="composer-region">{!nearBottom && <button className="jump-bottom" aria-label="回到底部" onClick={jumpToBottom}><ArrowDown size={16} /></button>}{stream !== 'live' && <div className={`stream-notice ${stream === 'error' ? 'stream-error' : ''}`}>{stream === 'error' ? '对话连接失败' : stream === 'reconnecting' ? '连接中断，正在恢复对话…' : '正在连接会话…'}{stream === 'error' && <button onClick={() => { setError(''); setRetry((value) => value + 1); }}>重新连接</button>}</div>}
        {commandNotice?.key === activeKey && <div className="command-notice" role="status"><span>{commandNotice.message}</span><button className="icon-button" aria-label="关闭命令结果" onClick={() => setCommandNotice(undefined)}><X size={14} /></button></div>}
        {status?.warnings?.map((warning, index) => <div className="session-warning" key={index}>{warning.message}</div>)}
        {status?.pendingDialogs?.[0] && <ExtensionPrompt key={status.pendingDialogs[0].dialogId} dialog={status.pendingDialogs[0]} session={selection.session} onError={report} />}
        {status?.queuedMessages?.length ? <div className="queued-messages">{status.queuedMessages.map((message, index) => <span key={index}>{message.kind === 'steering' ? '引导' : '排队'}：{message.text}</span>)}</div> : null}
        {selection.session.archived ? <div className="archived-notice"><Archive size={16} />此对话已归档<button onClick={() => void archiveSession()}>恢复对话</button></div> : <div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void readImages(Array.from(event.dataTransfer.files)); }}>
          {draft.attachments.length > 0 && <div className="draft-images">{draft.attachments.map((image, index) => <div key={index}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name || '附件'} /><button aria-label={`移除附件 ${index + 1}`} onClick={() => editDraft({ ...draft, attachments: draft.attachments.filter((_, at) => at !== index) })}><X size={12} /></button></div>)}</div>}
          <PromptInput key={draftKey} inputRef={textarea} session={selection.session} projectId={selection.project.id} workspaceId={selection.workspace.id} models={models} history={inputHistories.get(draftKey) || previousInputs(transcript)} value={draft.text} connected={stream === 'live'} disabled={sending} onChange={(text) => editDraft({ ...draft, text })} onSend={() => void send()} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void readImages(files); } }} />
          <div className="composer-toolbar"><input ref={attachmentInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(event) => { void readImages(Array.from(event.target.files || [])); event.target.value = ''; }} /><button className="icon-button" aria-label="添加图片" title="添加图片" onClick={() => attachmentInput.current?.click()}><ImagePlus size={17} /></button><select aria-label="模型" value={selectedModel} disabled={working || !models.length || stream !== 'live'} onChange={(event) => { const [provider, modelId] = event.target.value.split('\0'); void changeSessionSetting('session.model', { provider, modelId }); }}><option value="" disabled>选择模型</option>{allModels.map((model) => <option key={`${model.provider}:${model.id}`} value={`${model.provider}\0${model.id}`}>{model.name || model.id} · {model.provider}</option>)}</select>{levels.length > 0 && <select className="thinking-select" aria-label="思考强度" value={status?.thinkingLevel || levels[0]} disabled={working || stream !== 'live'} onChange={(event) => void changeSessionSetting('session.thinking', { level: event.target.value })}>{levels.map((level) => <option key={level} value={level}>{thinkingLabels[level] || level}</option>)}</select>}
            <div className="composer-send-actions">{working && <><select aria-label="发送方式" value={behavior} onChange={(event) => setBehavior(event.target.value)}><option value="followUp">排队发送</option><option value="steer">立即引导</option></select><button className="stop-button" aria-label="停止任务" title="停止任务" onClick={() => void piRequest('session.abort', sessionInput(selection.session)).catch(report)}><Square size={12} fill="currentColor" /></button></>}<button className="send-button" aria-label="发送" title="发送消息" disabled={sending || stream !== 'live' || (!draft.text.trim() && !draft.attachments.length)} onClick={() => void send()}>{sending ? <span className="spinner" /> : <ArrowUp size={19} />}</button></div>
          </div></div>}
        <div className="composer-footnote"><span><span className="online-dot" />SSH 已连接 · 远端执行</span><span>{status?.contextUsage?.percent != null ? `上下文 ${Math.round(status.contextUsage.percent)}% · ` : ''}{status?.cost ? `$${status.cost.toFixed(3)} · ` : ''}Enter 换行 · Ctrl/⌘ Enter 发送</span></div>
      </div></> : <div className="workspace-welcome"><span className="welcome-symbol">π</span><span className="eyebrow">REMOTE PI WORKSPACE</span><h1>让想法，成为进展。</h1><p>选择左侧的对话继续工作，<br />或从服务器上的一个目录开始。</p><div><button className="button primary" onClick={() => newSession()}><Plus size={16} />新建对话</button><button className="button secondary" onClick={() => setDialog('project')}><FolderPlus size={16} />添加项目</button></div><small><span className="online-dot" />已连接 {profile?.name}</small></div>}
    </main>
    {selection && displayedPanel && <Inspector key={selection.workspace.id} refreshVersion={retry} project={selection.project} workspace={selection.workspace} panel={displayedPanel} closing={!panel} onClose={() => setPanel(undefined)} onPanelChange={setPanel} resizeHandle={!phone && <ResizeHandle label={stackedPanel ? '调整面板高度' : '调整右侧栏宽度'} horizontal={stackedPanel} direction={-1} value={stackedPanel ? bottomHeight : rightWidth} min={stackedPanel ? 160 : 280} max={stackedPanel ? bottomMax : rightMax} onChange={(value) => setPaneSize(stackedPanel ? 'bottom' : 'right', value)} onReset={() => setPaneSize(stackedPanel ? 'bottom' : 'right')} onDragging={setResizing} />} />}
    {dialog && <WorkspaceDialog kind={dialog} groups={groups} initialProjectId={newProjectId} selection={selection} onClose={() => setDialog(undefined)} onCreated={(value) => { pick(value); setDialog(undefined); void refresh(); }} onUpdated={() => { setDialog(undefined); void refresh(); }} />}
    {command && selection && sessionKey(command.session) === activeKey && <CommandDialog key={`${activeKey}:${command.result.type === 'select' ? command.result.requestId : 'tree'}`} pending={command} onClose={() => setCommand(undefined)} onResult={(result, reload) => { applyCommandResult(selection, result, reload); }} onLocal={async (value) => {
      if (command.local === 'model') { const [provider, modelId] = value.split('\0'); const next = await piRequest<SessionStatus>('session.model', { ...sessionInput(command.session), provider, modelId }); if (selectionRef.current && sessionKey(selectionRef.current.session) === sessionKey(command.session)) setStatus(next); }
      else { const found = groups.flatMap((group) => group.workspaces.flatMap((entry) => entry.sessions.map((session) => ({ project: group.project, workspace: entry.workspace, session })))).find((entry) => sessionKey(entry.session) === value); if (!found) throw new Error('会话已不可用，请刷新项目。'); pick(found); }
    }} />}
    <KeyboardNew disabled={Boolean(dialog || (command && sessionKey(command.session) === activeKey) || status?.pendingDialogs?.length)} onNew={() => newSession()} />
  </div>;
}

function KeyboardNew({ onNew, disabled }: { onNew: () => void; disabled: boolean }) { useEffect(() => { const listener = (event: KeyboardEvent) => { if (disabled || event.defaultPrevented) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); onNew(); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [onNew, disabled]); return null; }

function ExtensionPrompt({ dialog, session, onError }: { dialog: ExtensionDialog; session: SessionInfo; onError: (reason: unknown) => void }) {
  const [value, setValue] = useState(''); const [busy, setBusy] = useState(false);
  const answer = async (cancel: boolean, response?: string | boolean) => { setBusy(true); try { await piRequest('session.dialog', { ...sessionInput(session), dialogId: dialog.dialogId, cancel, value: response }); } catch (reason) { onError(reason); setBusy(false); } };
  return <form className="extension-prompt" onSubmit={(event) => { event.preventDefault(); void answer(false, dialog.kind === 'confirm' ? true : value); }}><strong>{dialog.title}</strong>{dialog.message && <p>{dialog.message}</p>}{dialog.kind === 'select' && <select aria-label={dialog.title} value={value} onChange={(event) => setValue(event.target.value)}><option value="" disabled>请选择</option>{dialog.options?.map((option) => <option key={option}>{option}</option>)}</select>}{dialog.kind === 'input' && <input aria-label={dialog.title} placeholder={dialog.placeholder} value={value} onChange={(event) => setValue(event.target.value)} />}<div className="dialog-footer"><button type="button" disabled={busy} className="button secondary" onClick={() => void answer(true)}>取消</button><button disabled={busy || (dialog.kind !== 'confirm' && !value)} className="button primary">确认</button></div></form>;
}

function WorkspaceDialog({ kind, groups, initialProjectId, selection, onClose, onCreated, onUpdated }: { kind: 'project' | 'session' | 'rename'; groups: ProjectGroup[]; initialProjectId: string; selection?: Selection; onClose: () => void; onCreated: (value: Selection) => void; onUpdated: () => void }) {
  const dialogRef = useDialogFocus<HTMLFormElement>();
  const [projectId, setProjectId] = useState(initialProjectId || groups[0]?.project.id || '');
  const group = groups.find((item) => item.project.id === projectId);
  const [workspaceId, setWorkspaceId] = useState(group?.workspaces[0]?.workspace.id || '');
  const [path, setPath] = useState(''); const [name, setName] = useState(kind === 'rename' && selection ? sessionTitle(selection.session) : '');
  const [create, setCreate] = useState(false); const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [directories, setDirectories] = useState<{ path: string; kind: string }[]>([]);
  useEffect(() => { if (kind !== 'project' || !path) { setDirectories([]); return; } let active = true; const timer = setTimeout(() => void piRequest<{ path: string; kind: string }[]>('projects.directories', { query: path }).then((value) => { if (active) setDirectories(value); }).catch(() => {}), 250); return () => { active = false; clearTimeout(timer); }; }, [path, kind]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    const back = (event: Event) => { if (!event.defaultPrevented) { event.preventDefault(); if (!busy) onClose(); } };
    window.addEventListener('keydown', listener); window.addEventListener('remote-pi:back', back, true);
    return () => { window.removeEventListener('keydown', listener); window.removeEventListener('remote-pi:back', back, true); };
  }, [busy, onClose]);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (kind === 'rename' && selection) { await piRequest('session.rename', { ...sessionInput(selection.session), name }); onUpdated(); return; }
      let project = group?.project; let workspace = group?.workspaces.find((item) => item.workspace.id === workspaceId)?.workspace;
      if (kind === 'project') {
        project = await piRequest<Project>('projects.add', { path, ...(name.trim() ? { name: name.trim() } : {}), create });
        const result = await piRequest<{ workspaces: RemoteWorkspace[] }>('workspaces.list', { projectId: project.id }); workspace = result.workspaces.find((item) => item.isMain) || result.workspaces[0];
        if (workspace && trust) await piRequest('workspace.trust', { projectId: project.id, workspaceId: workspace.id, trusted: true });
      }
      if (!project || !workspace) throw new Error('该项目暂无可用工作区，请检查远端工作区插件。');
      const session = await piRequest<SessionInfo>('session.create', { cwd: workspace.path }); onCreated({ project, workspace, session });
    } catch (reason) { setError(reasonText(reason)); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><form ref={dialogRef} tabIndex={-1} className="workspace-dialog" role="dialog" aria-modal="true" aria-label={kind === 'project' ? '添加远端项目' : kind === 'session' ? '新建对话' : '重命名对话'} onSubmit={(event) => { event.preventDefault(); void submit(); }}><button type="button" className="modal-close icon-button" aria-label="关闭对话框" disabled={busy} onClick={onClose}><X size={18} /></button><span className="dialog-icon">{kind === 'project' ? <FolderPlus size={23} /> : <MessageSquare size={23} />}</span><h2>{kind === 'project' ? '添加远端项目' : kind === 'session' ? '开启一段新对话' : '重命名对话'}</h2><p>{kind === 'project' ? '选择服务器上的工作目录，对话与代码都保存在远端。' : kind === 'session' ? 'Pi 会在所选工作区中继续你的工作。' : '为这段对话起一个容易找到的名字。'}</p><fieldset disabled={busy}>
    {kind === 'project' ? <><label className="field">远端目录<input required autoFocus aria-label="远端目录" placeholder="/home/you/projects/my-app" value={path} onChange={(event) => setPath(event.target.value)} list="remote-directories" /><datalist id="remote-directories">{directories.map((entry) => <option key={entry.path} value={entry.path} />)}</datalist></label><label className="field">项目名称 <span className="optional">可选</span><input aria-label="项目名称" placeholder="使用目录名称" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="checkbox-field"><input type="checkbox" checked={create} onChange={(event) => setCreate(event.target.checked)} />目录不存在时创建</label><label className="checkbox-field"><input type="checkbox" checked={trust} onChange={(event) => setTrust(event.target.checked)} />信任此目录中的 Pi 扩展与配置</label></> : kind === 'session' ? <><label className="field">项目<select aria-label="选择项目" value={projectId} onChange={(event) => { setProjectId(event.target.value); setWorkspaceId(groups.find((item) => item.project.id === event.target.value)?.workspaces[0]?.workspace.id || ''); }}>{groups.map(({ project }) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field">工作区<select aria-label="选择工作区" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{group?.workspaces.map(({ workspace }) => <option key={workspace.id} value={workspace.id}>{workspace.label} · {workspace.path}</option>)}</select></label></> : <label className="field">对话名称<input autoFocus required maxLength={160} aria-label="对话名称" value={name} onChange={(event) => setName(event.target.value)} /></label>}
    </fieldset>{error && <div className="error-banner" role="alert">{error}</div>}<div className="dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy || (kind === 'session' && !workspaceId)}>{busy ? <><span className="spinner" />处理中…</> : kind === 'project' ? '添加并新建对话' : kind === 'session' ? '创建对话' : <><Check size={14} />保存名称</>}</button></div></form></div>;
}
