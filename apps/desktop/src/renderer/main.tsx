import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Fingerprint, Folder, KeyRound, Laptop, LockKeyhole, Moon, Plus, Server, ShieldCheck, Sun, Terminal, Trash2, Unplug, X } from 'lucide-react';
import type { AuthChallenge, ConnectionState, ServerProfile, Theme } from '../shared/types';
import './styles.css';
import { Workspace } from './workspace/Workspace';

const bridge = window.desktop;
const freshProfile = (): ServerProfile => ({ id: crypto.randomUUID(), name: '', host: '', username: '', port: null, identityFile: '', remotePort: 8504 });
const busy = (state: ConnectionState) => ['connecting', 'authenticating', 'checking'].includes(state.phase);
const address = (profile: ServerProfile) => `${profile.username ? `${profile.username}@` : ''}${profile.host}${profile.port ? `:${profile.port}` : ''}`;

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark">π<span /></span>{!compact && <div>Remote Pi<small>YOUR REMOTE WORKSPACE</small></div>}</div>;
}

function App() {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [draft, setDraft] = useState<ServerProfile>(freshProfile);
  const [theme, setTheme] = useState<Theme>('light');
  const [connection, setConnection] = useState<ConnectionState>({ phase: 'idle', message: '尚未连接服务器' });
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [screen, setScreen] = useState<'connections' | 'workspace'>('connections');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [help, setHelp] = useState(false);
  const connected = connection.phase === 'connected';
  const activeProfile = profiles.find((profile) => profile.id === connection.profileId);
  const inWorkspace = connected && screen === 'workspace';

  useEffect(() => {
    if (!bridge) { setError('请通过桌面 App 启动此页面：在项目目录运行 npm run dev。'); return; }
    const offConnection = bridge.onConnection((state) => {
      setConnection(state);
      if (state.phase === 'connected') setScreen('workspace');
      else if (state.phase === 'error') setScreen('connections');
    });
    const offChallenge = bridge.onChallenge(setChallenge);
    void Promise.all([bridge.getSettings(), bridge.getConnection()]).then(([settings, state]) => {
      setProfiles(settings.profiles); setTheme(settings.theme); setConnection(state);
      if (settings.profiles[0]) setDraft(settings.profiles[0]);
      if (state.phase === 'connected') setScreen('workspace');
    }).catch((reason) => setError(String(reason)));
    return () => { offConnection(); offChallenge(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const updateDraft = (patch: Partial<ServerProfile>) => { setDraft((value) => ({ ...value, ...patch })); setSaved(false); setError(''); };
  const save = async (): Promise<ServerProfile> => {
    const profile = await bridge.saveProfile({ ...draft, name: draft.name.trim() || draft.host.trim() });
    setDraft(profile);
    setProfiles((items) => [...items.filter((item) => item.id !== profile.id), profile]);
    setSaved(true);
    return profile;
  };
  const connect = async (event?: React.FormEvent) => {
    event?.preventDefault(); setError('');
    try { const profile = await save(); await bridge.connect(profile); }
    catch (reason) { setError((reason as Error).message); }
  };
  const pickProfile = (profile: ServerProfile) => { setDraft(profile); setSaved(false); setError(''); setScreen('connections'); };
  const changeTheme = async () => {
    const next = theme === 'light' ? 'dark' : 'light';
    try { await bridge.setTheme(next); setTheme(next); } catch (reason) { setError((reason as Error).message); }
  };
  const remove = async () => {
    try {
      await bridge.deleteProfile(draft.id);
      const remaining = profiles.filter((profile) => profile.id !== draft.id);
      setProfiles(remaining); setDraft(remaining[0] ?? freshProfile()); setError('');
    } catch (reason) { setError((reason as Error).message); }
  };
  const disconnect = () => { void bridge.disconnect().catch((reason) => setError(String(reason))); };

  if (inWorkspace) return <><Workspace profile={activeProfile} theme={theme} onManage={() => setScreen('connections')} onTheme={() => void changeTheme()} onDisconnect={disconnect} />{challenge && <AuthDialog challenge={challenge} onAnswer={(answer) => void bridge.answerChallenge(challenge.id, answer).catch((reason) => setError(String(reason)))} />}</>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="traffic-spacer" />
      <Brand />
      <div className="sidebar-section-label">服务器 <span>{profiles.length.toString().padStart(2, '0')}</span></div>
      <nav className="server-list" aria-label="服务器列表">
        {profiles.map((profile) => <button key={profile.id} title={profile.name} className={`server-item ${draft.id === profile.id ? 'selected' : ''}`} disabled={busy(connection)} onClick={() => {
          pickProfile(profile);
        }}>
          <span className="server-icon"><Server size={17} />{connection.profileId === profile.id && connected && <i />}</span>
          {<><span className="server-description"><strong>{profile.name}</strong><small>{address(profile)}</small></span>{connection.profileId === profile.id && connected ? <span className="online-dot" /> : <ChevronRight size={14} className="muted" />}</>}
        </button>)}
        {!profiles.length && <div className="empty-servers"><Server size={20} /><span>你的服务器会显示在这里</span></div>}
        <button className="add-server" title="添加服务器" disabled={busy(connection)} onClick={() => { setDraft(freshProfile()); setSaved(false); setError(''); setScreen('connections'); }}><Plus size={17} />添加服务器</button>
      </nav>
      <div className="sidebar-bottom">
        <button className="help-button" title="使用说明" onClick={() => setHelp(true)}><CircleHelp size={16} />使用说明</button>
        {<div className="sidebar-footnote"><span className="online-dot" />本地客户端 <span>v0.2.24</span></div>}
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><span className="brand-small">Remote Pi</span><span className="crumb-slash">/</span><strong>连接管理</strong></div>
        <div className="topbar-actions">
          {connected && <><span className="connected-badge"><span className="online-dot" />SSH 已连接</span>
            <button className="icon-button" title="返回工作台" aria-label="返回工作台" onClick={() => setScreen('workspace')}><Server size={17} /></button>
            <button className="icon-button" title="断开连接" aria-label="断开连接" onClick={disconnect}><Unplug size={17} /></button><span className="toolbar-divider" /></>}
          <button className="icon-button" title="切换主题" aria-label="切换主题" onClick={() => void changeTheme()}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
        </div>
      </header>

      {<div className="connection-content">
        <section className="intro">
          <div><div className="eyebrow"><span />本地掌控 · 远端执行</div><h1>你的远端工作台。<br /><span>现在，就在手边。</span></h1><p>连接服务器，回到项目与对话。<br />代码、环境和正在进行的工作，都留在远端。</p></div>
          <div className="connection-illustration" aria-hidden="true"><div className="illustration-node"><Laptop size={25} /><span>本地 App</span></div><div className="illustration-line"><i /><LockKeyhole size={13} /><i /></div><div className="illustration-node remote"><Server size={25} /><span>远端 Pi</span><b /></div></div>
        </section>

        <div className="connection-grid">
          <section className="connection-card">
            <div className="card-heading"><span className="card-icon"><Terminal size={19} /></span><div><h2>{profiles.some((profile) => profile.id === draft.id) ? draft.name : '连接一台服务器'}</h2><p>通过 SSH 建立你的专属工作空间</p></div>{profiles.some((profile) => profile.id === draft.id) && <button className="icon-button delete-button" aria-label="删除服务器配置" title="删除服务器配置" disabled={busy(connection)} onClick={() => void remove()}><Trash2 size={16} /></button>}</div>
            <form onSubmit={(event) => void connect(event)}>
              <fieldset disabled={busy(connection)}>
                <label className="field">连接名称 <span className="optional">可选</span><input aria-label="连接名称" value={draft.name} placeholder="例如：开发服务器" onChange={(event) => updateDraft({ name: event.target.value })} /></label>
                <div className="field-row host-row"><label className="field">服务器地址 <input required autoComplete="off" aria-label="服务器地址" value={draft.host} placeholder="dev-server 或 192.168.1.10" onChange={(event) => updateDraft({ host: event.target.value })} /></label><label className="field">用户名 <span className="optional">可选</span><input aria-label="用户名" value={draft.username} placeholder="沿用 SSH 配置" onChange={(event) => updateDraft({ username: event.target.value })} /></label></div>
                <details className="advanced"><summary><ChevronDown size={14} />端口与私钥设置<span>默认即可连接大多数服务器</span></summary><div className="advanced-body">
                  <div className="field-row"><label className="field">SSH 端口<input type="number" min="1" max="65535" aria-label="SSH 端口" value={draft.port ?? ''} placeholder="22 或 SSH 配置中的端口" onChange={(event) => updateDraft({ port: event.target.value ? Number(event.target.value) : null })} /></label><label className="field">远端 Pi Web 端口<input type="number" required min="1" max="65535" aria-label="远端 Pi Web 端口" value={draft.remotePort} onChange={(event) => updateDraft({ remotePort: Number(event.target.value) })} /></label></div>
                  <label className="field">SSH 私钥 <span className="optional">可选</span><div className="identity-field"><KeyRound size={15} /><input aria-label="SSH 私钥" value={draft.identityFile} placeholder="使用默认密钥或 ssh-agent" onChange={(event) => updateDraft({ identityFile: event.target.value })} /><button type="button" onClick={() => void bridge.pickIdentity().then((path) => { if (path) updateDraft({ identityFile: path }); }).catch((reason) => setError(String(reason)))}><Folder size={15} />选择</button>{draft.identityFile && <button type="button" title="清除私钥路径" aria-label="清除私钥路径" onClick={() => updateDraft({ identityFile: '' })}><X size={14} /></button>}</div></label>
                </div></details>
              </fieldset>
              {(error || connection.phase === 'error') && <div className="error-banner" role="alert"><span>连接未完成</span><pre>{error || connection.message}</pre></div>}
              {busy(connection) && <div className="progress-banner" role="status"><span className="spinner" /><span>{connection.message}</span><button type="button" onClick={disconnect}>取消</button></div>}
              <div className="form-footer"><span className="privacy-note"><ShieldCheck size={14} />密码与口令仅用于当次认证</span><div className="form-buttons"><button type="button" className="button secondary" disabled={busy(connection) || !draft.host} onClick={() => void save().catch((reason) => setError((reason as Error).message))}>{saved ? <><Check size={14} />已保存</> : '保存配置'}</button>
                {connected && draft.id === connection.profileId ? <button type="button" className="button primary" onClick={() => setScreen('workspace')}>返回工作台<ArrowRight size={16} /></button> : <button type="submit" className="button primary" disabled={busy(connection) || !draft.host}>{busy(connection) ? <><span className="spinner" />连接中</> : <>连接工作台<ArrowRight size={16} /></>}</button>}
              </div></div>
            </form>
          </section>

          <aside className="guide"><span className="guide-label">接下来，会发生什么</span><div className="guide-step"><span>01</span><div><h3>建立连接</h3><p>沿用 SSH 配置与密钥。<br />需要时，在 App 内完成认证。</p></div></div><div className="guide-step"><span>02</span><div><h3>进入工作台</h3><p>进入全新项目与对话界面，<br />代码、变更和终端随时可用。</p></div></div><div className="guide-step"><span>03</span><div><h3>随时回来</h3><p>关闭 App 后，服务器上的<br />任务仍可继续运行。</p></div></div><div className="guide-note"><LockKeyhole size={17} /><p>连接全程经过 SSH 隧道。<br />服务器无需开放 Pi Web 端口。</p></div></aside>
        </div>
        <div className="setup-hint"><Server size={15} /><span>服务器需已启动 Pi Web，默认监听 <code>127.0.0.1:8504</code></span><button onClick={() => setHelp(true)}>查看部署说明<ArrowRight size={13} /></button></div>
      </div>}
      <footer className="statusbar"><span><span className={`status-dot ${connected ? 'is-online' : busy(connection) ? 'is-busy' : ''}`} />{connected ? `${activeProfile ? address(activeProfile) : 'SSH'} · 远端工作区` : busy(connection) ? connection.message : '就绪，等待连接'}</span><span><LockKeyhole size={11} />{connected ? `Pi Web · 127.0.0.1:${activeProfile?.remotePort ?? 8504}` : 'OpenSSH · 端到端加密连接'}</span></footer>
    </main>
    {challenge && <AuthDialog challenge={challenge} onAnswer={(answer) => void bridge.answerChallenge(challenge.id, answer).catch((reason) => setError(String(reason)))} />}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="使用说明" onClick={(event) => event.stopPropagation()}><button className="modal-close icon-button" aria-label="关闭使用说明" onClick={() => setHelp(false)}><X size={18} /></button><span className="dialog-icon"><Terminal size={24} /></span><h2>准备你的远端工作台</h2><p>使用服务器上已配置好 Pi 的同一个用户安装 Pi Web。需要 Node.js ≥ 22.19 和 Pi 1.x。</p><pre>npm install -g @jmfederico/pi-web --allow-scripts=node-pty<br />pi-web install<br />pi-web doctor<br />pi-web status</pre><p>Linux 用户服务需要在退出 SSH 后继续运行时：</p><pre>sudo loginctl enable-linger "$USER"</pre><p>回到 App，填写服务器地址并连接。SSH 别名、ProxyJump、默认身份文件和 ssh-agent 都由系统 OpenSSH 读取。</p><div className="help-note"><ShieldCheck size={17} />首次连接请核对主机指纹。密码不会保存在本地配置中。断开连接不会停止远端 Pi Web 服务。</div><button className="button primary" onClick={() => setHelp(false)}>开始连接<ArrowRight size={16} /></button></section></div>}
  </div>;
}

function AuthDialog({ challenge, onAnswer }: { challenge: AuthChallenge; onAnswer: (answer: string | null) => void }) {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { setAnswer(''); setSubmitting(false); }, [challenge.id]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onAnswer(null); };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [challenge.id, onAnswer]);
  const host = challenge.kind === 'host';
  return <div className="modal-backdrop"><form className="auth-dialog" role="dialog" aria-modal="true" aria-label={host ? '确认服务器身份' : 'SSH 身份验证'} onSubmit={(event) => { event.preventDefault(); setSubmitting(true); onAnswer(host ? 'yes' : answer); setAnswer(''); }}>
    <span className="dialog-icon">{host ? <Fingerprint size={25} /> : <KeyRound size={25} />}</span><h2>{host ? '确认服务器身份' : '完成 SSH 身份验证'}</h2><p>{host ? '首次连接此服务器。请核对下面的主机指纹，确认后会保存到系统 known_hosts。' : '请输入 SSH 请求的密码、私钥口令或验证码。此内容仅用于当前连接。'}</p><pre className="auth-prompt">{challenge.prompt}</pre>
    {!host && <label className="field">密码 / 口令 / 验证码<input autoFocus type="password" aria-label="SSH 验证响应" autoComplete="off" value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>}
    <div className="dialog-footer"><button type="button" className="button secondary" onClick={() => onAnswer(null)}>取消连接</button><button type="submit" className="button primary" disabled={submitting}>{submitting ? '提交中…' : host ? '信任并连接' : '继续连接'}<ArrowRight size={15} /></button></div>
  </form></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
