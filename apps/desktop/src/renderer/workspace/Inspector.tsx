import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowLeft, ChevronRight, File, Folder, RefreshCw, X } from 'lucide-react';
import type { FileContent, FileTree, GitStatus, Project, Workspace } from '../../shared/pi';
import { piRequest } from './api';
import '@xterm/xterm/css/xterm.css';
export type Panel = 'files' | 'diff' | 'terminal';

export function Inspector({ project, workspace, panel, closing, onClose, resizeHandle }: { project: Project; workspace: Workspace; panel: Panel; closing?: boolean; onClose: () => void; resizeHandle: ReactNode }) {
  const [path, setPath] = useState('');
  const [tree, setTree] = useState<FileTree>();
  const [file, setFile] = useState<FileContent>();
  const [git, setGit] = useState<GitStatus>();
  const [diff, setDiff] = useState<{ diff: string; truncated?: boolean }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [staged, setStaged] = useState(false);
  const [diffPath, setDiffPath] = useState('');
  const scope = { projectId: project.id, workspaceId: workspace.id };
  useEffect(() => {
    let active = true; setError(''); setLoading(true);
    if (panel === 'terminal') { setLoading(false); return; }
    const load = panel === 'files' ? piRequest<FileTree>('files.tree', { ...scope, path }).then((value) => { if (active) setTree(value); }) : piRequest<GitStatus>('git.status', scope).then(async (status) => { if (!active) return; setGit(status); if (!status.isGitRepo) { setDiff({ diff: '' }); return; } const value = await piRequest<{ diff: string; truncated?: boolean }>('git.diff', { ...scope, staged, ...(diffPath ? { path: diffPath } : {}) }); if (active) setDiff(value); });
    void load.catch((reason) => { if (active) setError((reason as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project.id, workspace.id, panel, path, revision, staged, diffPath]);
  useEffect(() => { setFile(undefined); setTree(undefined); setPath(''); setDiffPath(''); }, [project.id, workspace.id]);
  const openFile = async (filePath: string) => {
    const current = ++fileGeneration.current; setError(''); setLoading(true);
    try { const value = await piRequest<FileContent>('files.read', { ...scope, path: filePath }); if (current === fileGeneration.current) setFile(value); }
    catch (reason) { if (current === fileGeneration.current) setError((reason as Error).message); }
    finally { if (current === fileGeneration.current) setLoading(false); }
  };
  const fileGeneration = useRef(0);
  useEffect(() => () => { fileGeneration.current++; }, [project.id, workspace.id, panel, path, revision]);
  return <aside className={`inspector ${panel === 'terminal' ? 'terminal-inspector' : ''} ${closing ? 'inspector-closing' : ''}`} inert={closing} aria-hidden={closing} aria-label="工作区面板"><div className="inspector-surface"><header><strong>{panel === 'files' ? '文件' : panel === 'diff' ? '变更' : '终端'}</strong><span>{workspace.label}</span>{panel !== 'terminal' && <button className="icon-button" title="刷新面板" onClick={() => { setFile(undefined); setRevision((value) => value + 1); }}><RefreshCw size={14} /></button>}<button className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={16} /></button></header>
    {error && <div className="panel-error" role="alert">{error}</div>}{loading && <div className="panel-loading"><span className="spinner" />加载中…</div>}
    {panel === 'terminal' ? <TerminalPane key={workspace.id} projectId={project.id} workspaceId={workspace.id} /> : panel === 'files' ? <>{file ? <><button className="file-back" onClick={() => setFile(undefined)}><ArrowLeft size={14} />{file.path}</button>{file.binary ? <div className="panel-empty">二进制文件，暂不支持预览。</div> : <pre className="file-preview">{file.content}</pre>}{file.truncated && <div className="panel-note">文件过大，仅显示部分内容。</div>}</> : <><div className="directory-path"><button disabled={!path} aria-label="上级目录" onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}><ArrowLeft size={14} /></button><span title={workspace.path}>{path || workspace.path}</span></div><div className="file-list">{tree?.entries.map((entry) => <button key={entry.path} onClick={() => entry.type === 'directory' ? setPath(entry.path) : void openFile(entry.path)}>{entry.type === 'directory' ? <Folder size={15} /> : <File size={15} />}<span>{entry.name}</span>{entry.type === 'directory' && <ChevronRight size={13} />}</button>)}{tree?.truncated && <div className="panel-note">目录条目较多，已截断显示。</div>}{tree && !tree.entries.length && <div className="panel-empty">此目录为空</div>}</div></>}</> : <><div className="diff-controls"><select aria-label="变更类型" value={staged ? 'staged' : 'working'} onChange={(event) => setStaged(event.target.value === 'staged')}><option value="working">工作区</option><option value="staged">暂存区</option></select><span>{git?.branch}</span></div><select className="diff-file-select" aria-label="查看文件差异" value={diffPath} onChange={(event) => setDiffPath(event.target.value)}><option value="">全部文件 · {git?.files.length || 0} 个变更</option>{git?.files.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select><div className="diff-content">{diff?.diff ? <pre>{diff.diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : line.startsWith('@@') ? 'diff-location' : ''}>{line || ' '}</span>)}</pre> : !loading && !error && <div className="panel-empty">{git?.isGitRepo === false ? '此目录不是 Git 仓库' : '暂无变更'}</div>}</div>{diff?.truncated && <div className="panel-note">差异过大，已截断显示。</div>}</>}
  </div>{resizeHandle}</aside>;
}

function TerminalPane({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = crypto.randomUUID(); const terminal = new XTerminal({ fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 12, cursorBlink: true, scrollback: 5000, theme: { background: '#191b1d', foreground: '#e6e6e2' } });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element.current!); fit.fit(); terminal.focus();
    const off = window.desktop.onTerminal((packet) => { if (packet.subscriptionId !== id) return; if (packet.type === 'output' && packet.data) terminal.write(packet.data); if (packet.type === 'error') setError(packet.message || '终端连接失败'); if (packet.type === 'exit') setError(`进程已结束（${packet.exitCode ?? 0}）`); if (packet.type === 'ready') setReady(true); });
    const input = terminal.onData((data) => window.desktop.terminalInput(id, data));
    const observer = new ResizeObserver(() => { fit.fit(); window.desktop.terminalResize(id, terminal.cols, terminal.rows); }); observer.observe(element.current!);
    void window.desktop.attachTerminal(projectId, workspaceId, id, terminal.cols, terminal.rows).catch((reason) => setError((reason as Error).message));
    return () => { off(); observer.disconnect(); input.dispose(); terminal.dispose(); void window.desktop.detachTerminal(id); };
  }, [projectId, workspaceId]);
  return <div className="terminal-pane">{!ready && !error && <div className="terminal-note">正在连接远端终端…</div>}{error && <div className="terminal-note" role="alert">{error}</div>}<div ref={element} className="xterm-container" /></div>;
}
