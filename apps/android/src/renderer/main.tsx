import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { ArrowRight, Check, Fingerprint, FolderKey, KeyRound, LockKeyhole, Moon, Plus, Server, Sun, Trash2, Unplug, X } from 'lucide-react';
import type { AuthChallenge, ConnectionState, ServerProfile, Theme } from '../shared/types';
import { createAndroidBridge } from '../platform/bridge';
import { Workspace } from './workspace/Workspace';
import './styles.css';
import './mobile.css';

const fresh = (): ServerProfile => ({ id: crypto.randomUUID(), name: '', host: '', username: '', port: 22, identityFile: '', remotePort: 8504 });
const busy = (state: ConnectionState) => ['connecting', 'authenticating', 'checking'].includes(state.phase);

function App() {
  const bridge = window.desktop;
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [draft, setDraft] = useState(fresh);
  const [theme, setTheme] = useState<Theme>('light');
  const [connection, setConnection] = useState<ConnectionState>({ phase: 'idle', message: '准备连接' });
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [manage, setManage] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const active = connection.phase === 'connected';
  const profile = profiles.find((item) => item.id === connection.profileId);
  useEffect(() => {
    const offState = bridge.onConnection((state) => { setConnection(state); if (state.phase === 'connected') setManage(false); });
    const offChallenge = bridge.onChallenge(setChallenge);
    void Promise.all([bridge.getSettings(), bridge.getConnection()]).then(([settings, state]) => { setProfiles(settings.profiles); setTheme(settings.theme); setConnection(state); if (settings.profiles[0]) setDraft(settings.profiles[0]); if (state.phase === 'connected') setManage(false); }).catch((reason) => setError(String(reason)));
    return () => { offState(); offChallenge(); };
  }, [bridge]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#222325' : '#fafafa');
    if (Capacitor.isNativePlatform()) void SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  }, [theme]);
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const edit = (patch: Partial<ServerProfile>) => { setDraft((value) => ({ ...value, ...patch })); setError(''); setSaved(false); };
  const save = async () => { const value = await bridge.saveProfile({ ...draft, name: draft.name.trim() || draft.host.trim() }); setDraft(value); setProfiles((previous) => [...previous.filter((item) => item.id !== value.id), value]); setSaved(true); return value; };
  const connect = async () => { setError(''); try { await bridge.connect(await save()); } catch (reason) { report(reason); } };
  const disconnect = () => { void bridge.disconnect().catch(report); };
  const toggleTheme = () => { const next = theme === 'light' ? 'dark' : 'light'; void bridge.setTheme(next).then(() => setTheme(next)).catch(report); };
  const remove = async () => { try { await bridge.deleteProfile(draft.id); const next = profiles.filter((item) => item.id !== draft.id); setProfiles(next); setDraft(next[0] || fresh()); } catch (reason) { report(reason); } };
  return <>{active && !manage ? <Workspace profile={profile} theme={theme} onManage={() => setManage(true)} onTheme={toggleTheme} onDisconnect={disconnect} /> : <div className="mobile-connections"><header className="mobile-app-header"><div className="mobile-brand"><span>π</span><strong>Remote Pi</strong><small>ANDROID</small></div><button className="icon-button" aria-label="切换主题" onClick={toggleTheme}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button></header>
    <main><div className="mobile-intro"><div className="eyebrow"><span />你的服务器，随身同行</div><h1>回到工作。<br /><span>随时，随地。</span></h1><p>在手机上继续项目与对话。<br />代码和任务，留在你的服务器。</p></div>
    <div className="mobile-section-heading"><span>服务器</span><button disabled={busy(connection)} onClick={() => { setDraft(fresh()); setSaved(false); setError(''); }}><Plus size={15} />添加</button></div>
    {profiles.length > 0 && <div className="mobile-server-list" aria-label="服务器列表">{profiles.map((item) => <button key={item.id} disabled={busy(connection)} className={item.id === draft.id ? 'selected' : ''} onClick={() => { setDraft(item); setSaved(false); setError(''); }}><Server size={16} /><span>{item.name}</span>{connection.profileId === item.id && active && <i />}</button>)}</div>}
    <section className="mobile-connection-card"><div className="mobile-card-heading"><span className="server-square"><Server size={19} /></span><div><h2>{draft.name || '连接一台服务器'}</h2><p>通过 SSH 安全访问远端 Pi</p></div>{profiles.some((item) => item.id === draft.id) && <button className="icon-button" aria-label="删除服务器配置" disabled={busy(connection)} onClick={() => void remove()}><Trash2 size={17} /></button>}</div>
    <form onSubmit={(event) => { event.preventDefault(); void connect(); }}><fieldset disabled={busy(connection)}><label className="field">连接名称 <span className="optional">可选</span><input aria-label="连接名称" value={draft.name} placeholder="开发服务器" onChange={(event) => edit({ name: event.target.value })} /></label>
    <label className="field">服务器地址<input required autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" aria-label="服务器地址" value={draft.host} placeholder="192.168.1.10 或 server.example.com" onChange={(event) => edit({ host: event.target.value })} /></label>
    <label className="field">SSH 用户名<input required autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="SSH 用户名" value={draft.username} placeholder="例如 ubuntu" onChange={(event) => edit({ username: event.target.value })} /></label>
    <details className="mobile-advanced"><summary>端口与私钥设置<span>SSH {draft.port || 22} · Pi Web {draft.remotePort}</span></summary><div className="field-row"><label className="field">SSH 端口<input aria-label="SSH 端口" required type="number" inputMode="numeric" min="1" max="65535" value={draft.port || 22} onChange={(event) => edit({ port: Number(event.target.value) })} /></label><label className="field">Pi Web 端口<input aria-label="Pi Web 端口" required type="number" inputMode="numeric" min="1" max="65535" value={draft.remotePort} onChange={(event) => edit({ remotePort: Number(event.target.value) })} /></label></div>
    <label className="field">SSH 私钥 <span className="optional">可选</span></label><div className="mobile-key-row"><button type="button" onClick={() => void bridge.pickIdentity().then((identity) => { if (identity) edit({ identityFile: identity }); }).catch(report)}><FolderKey size={17} /><span>{draft.identityFile ? '已导入私钥' : '从手机导入私钥'}</span></button>{draft.identityFile && <button type="button" aria-label="清除私钥选择" onClick={() => edit({ identityFile: '' })}><X size={17} /></button>}</div><p className="mobile-key-note">私钥加密保存在此设备。密码与私钥口令仅用于当次认证。</p></details></fieldset>
    {(error || connection.phase === 'error') && <div className="error-banner" role="alert">{error || connection.message}</div>}{busy(connection) && <div className="progress-banner" role="status"><span className="spinner" />{connection.message}<button type="button" onClick={disconnect}>取消</button></div>}
    <div className="mobile-form-actions">{active && draft.id === connection.profileId ? <><button className="button secondary" type="button" onClick={disconnect}><Unplug size={15} />断开</button><button type="button" className="button primary" onClick={() => setManage(false)}>返回工作台<ArrowRight size={16} /></button></> : <><button className="button secondary" type="button" disabled={busy(connection) || !draft.host || !draft.username} onClick={() => void save().catch(report)}>{saved ? <><Check size={15} />已保存</> : '保存配置'}</button><button type="submit" className="button primary" disabled={busy(connection) || !draft.host || !draft.username}>{busy(connection) ? '连接中…' : <>连接工作台<ArrowRight size={16} /></>}</button></>}</div></form></section>
    <div className="mobile-connect-note"><LockKeyhole size={17} /><p>Pi Web 无需开放公网端口。<br />离开 App 后，远端任务继续执行。</p></div><p className="mobile-version">Remote Pi for Android · 0.2.3</p></main>
  </div>}{challenge && <AuthDialog challenge={challenge} onAnswer={(answer) => void bridge.answerChallenge(challenge.id, answer).catch(report)} />}</>;
}
function AuthDialog({ challenge, onAnswer }: { challenge: AuthChallenge; onAnswer: (answer: string | null) => void }) {
  const [answer, setAnswer] = useState(''); const [submitting, setSubmitting] = useState(false);
  useEffect(() => { setAnswer(''); setSubmitting(false); }, [challenge.id]);
  useEffect(() => { const back = (event: Event) => { event.preventDefault(); onAnswer(null); }; window.addEventListener('remote-pi:back', back); return () => window.removeEventListener('remote-pi:back', back); }, [challenge.id]);
  const host = challenge.kind === 'host';
  return <div className="modal-backdrop"><form className="auth-dialog" role="dialog" aria-modal="true" aria-label={host ? '确认服务器身份' : 'SSH 身份验证'} onSubmit={(event) => { event.preventDefault(); setSubmitting(true); onAnswer(host ? 'yes' : answer); setAnswer(''); }}><span className="dialog-icon">{host ? <Fingerprint size={26} /> : <KeyRound size={26} />}</span><h2>{host ? '确认服务器身份' : '完成 SSH 身份验证'}</h2><p>{host ? '首次连接此服务器，请核对主机指纹。' : '输入服务器请求的密码、私钥口令或验证码。'}</p><pre className="auth-prompt">{challenge.prompt}</pre>{!host && <label className="field">验证响应<input autoFocus type="password" aria-label="SSH 验证响应" autoComplete="off" value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>}<div className="dialog-footer"><button className="button secondary" type="button" disabled={submitting} onClick={() => onAnswer(null)}>取消连接</button><button className="button primary" disabled={submitting}>{submitting ? '提交中…' : host ? '信任并连接' : '继续连接'}</button></div></form></div>;
}
async function start() {
  try { if (!window.desktop) window.desktop = await createAndroidBridge(); createRoot(document.getElementById('root')!).render(<App />); }
  catch { createRoot(document.getElementById('root')!).render(<div className="unsupported-preview"><span>π</span><h1>Remote Pi for Android</h1><p>请在 Android App 中打开。浏览器仅用于界面开发，无法建立原生 SSH 连接。</p></div>); }
}
void start();
