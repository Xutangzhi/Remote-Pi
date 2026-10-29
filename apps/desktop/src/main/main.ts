import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, screen, type IpcMainInvokeEvent } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SettingsStore } from './profiles';
import { AuthBroker } from './auth-broker';
import { TunnelManager } from './tunnel';
import { PiClient } from './pi-client';
import type { AuthChallenge, ConnectionState, EnvironmentRefresh, Theme } from '../shared/types';

app.setName('Remote Pi');
protocol.registerSchemesAsPrivileged([{ scheme: 'remote-pi', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const testMode = !app.isPackaged && process.env.REMOTE_PI_TEST_MODE === '1';
if (testMode && process.env.REMOTE_PI_USER_DATA) app.setPath('userData', process.env.REMOTE_PI_USER_DATA);
let mainWindow: BrowserWindow;
const pi = new PiClient();
let store: SettingsStore;
let auth: AuthBroker;
let tunnel: TunnelManager;
let quitting = false;
let closing = false;
let environmentState: EnvironmentRefresh | null = null;
let environmentTask: Promise<void> | undefined;

function requireEnvironmentIdle(): void {
  if (environmentTask) throw new Error('正在刷新远端环境，请等待完成。');
}
function environmentProgress(state: EnvironmentRefresh): void {
  environmentState = state;
  broadcast('environment:state', state);
}
function refreshEnvironment(): Promise<void> {
  requireEnvironmentIdle();
  const profile = store.get().profiles.find((item) => item.id === tunnel.state.profileId);
  const url = pi.url;
  if (!profile || !url || tunnel.state.phase !== 'connected') throw new Error('请先连接服务器工作台。');
  environmentProgress({ phase: 'checking', message: '正在通过新的 SSH 连接检查远端环境…' });
  environmentTask = (async () => {
    try {
      const script = await readFile(join(__dirname, 'refresh-environment.py'), 'utf8');
      const message = await tunnel.refreshEnvironment(profile, script, environmentProgress);
      if (tunnel.state.phase !== 'connected') throw new Error('服务已刷新，SSH 隧道已断开，请重新连接工作台。');
      pi.connect(url);
      await pi.request('machine.status');
      broadcast('workspace:refresh', null);
      environmentProgress({ phase: 'done', message });
    } catch (error) {
      if (tunnel.state.phase === 'connected') { pi.connect(url); broadcast('workspace:refresh', null); }
      environmentProgress({ phase: 'error', message: (error as Error).message });
    } finally { environmentTask = undefined; }
  })();
  return environmentTask;
}

function broadcast(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}
function trustedSender(event: IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted IPC sender');
}
function handle(channel: string, callback: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => { trustedSender(event); return callback(...args); });
}
function validWebURL(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}
function openLinkInsideApp(url: string): void {
  if (!validWebURL(url)) return;
  const child = new BrowserWindow({ parent: mainWindow, width: 1040, height: 760, title: 'Remote Pi · Browser',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }, });
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  child.webContents.on('will-navigate', (event, next) => { if (!validWebURL(next)) event.preventDefault(); });
  child.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  void child.loadURL(url).catch(() => {});
}

function registerIPC(): void {
  handle('settings:get', () => store.get());
  handle('profile:save', (profile) => store.saveProfile(profile));
  handle('profile:delete', async (id) => {
    requireEnvironmentIdle();
    if (typeof id !== 'string') throw new Error('Invalid profile ID');
    if (tunnel.state.profileId === id) { auth.cancelAll(); await tunnel.disconnect(); }
    await store.deleteProfile(id);
  });
  handle('identity:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择 SSH 私钥', properties: ['openFile', 'showHiddenFiles'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('connection:get', () => tunnel.state);
  handle('connection:connect', async (profile) => {
    requireEnvironmentIdle();
    environmentState = null;
    auth.cancelAll();
    const saved = await store.saveProfile(profile);
    const url = await tunnel.connect(saved);
    if (url) { pi.connect(url); broadcast('connection:state', tunnel.state); }
  });
  handle('connection:disconnect', async () => { requireEnvironmentIdle(); auth.cancelAll(); await tunnel.disconnect(); });
  handle('environment:get', () => environmentState);
  handle('environment:refresh', refreshEnvironment);
  handle('auth:answer', async (id, answer) => {
    if (typeof id !== 'string' || (answer !== null && (typeof answer !== 'string' || answer.length > 8192 || /[\r\n]/.test(answer)))) throw new Error('无效的 SSH 验证响应。');
    if (answer === null) { auth.cancelAll(); if (!environmentTask) await tunnel.disconnect(); }
    else auth.answer(id, answer);
  });
  handle('theme:set', async (theme: Theme) => {
    await store.setTheme(theme);
    nativeTheme.themeSource = theme;
  });
  handle('pi:request', (operation, input) => {
    if (environmentTask && !['machine.status', 'sessions.unread', 'projects.list', 'workspaces.list', 'sessions.list', 'session.status', 'session.models', 'session.thinkingLevels', 'session.messages', 'session.commands', 'files.suggest'].includes(operation)) requireEnvironmentIdle();
    return pi.request(operation, input);
  });
  handle('pi:watch', (session, subscriptionId) => pi.watchSession(session, subscriptionId));
  handle('pi:unwatch', (subscriptionId) => pi.unwatch(subscriptionId));
  handle('pi:terminal:attach', (projectId, workspaceId, subscriptionId, cols, rows) => {
    requireEnvironmentIdle();
    if (![cols, rows].every((value) => Number.isInteger(value) && value > 0 && value < 1000)) throw new Error('终端大小无效。');
    return pi.attachTerminal(projectId, workspaceId, subscriptionId, cols, rows);
  });
  handle('pi:terminal:detach', (subscriptionId) => pi.detachTerminal(subscriptionId));
  ipcMain.on('pi:terminal:input', (event, subscriptionId, data) => {
    trustedSender(event);
    if (!environmentTask && typeof data === 'string' && Buffer.byteLength(data) <= 48_000) pi.terminalFrame(subscriptionId, { type: 'input', data });
  });
  ipcMain.on('pi:terminal:resize', (event, subscriptionId, cols, rows) => {
    trustedSender(event);
    if ([cols, rows].every((value) => Number.isInteger(value) && value > 0 && value < 1000)) pi.terminalFrame(subscriptionId, { type: 'resize', cols, rows });
  });
  handle('link:open', (url) => { if (typeof url === 'string') openLinkInsideApp(url); });

}

async function boot(): Promise<void> {
  const rendererRoot = resolve(__dirname, 'renderer');
  protocol.handle('remote-pi', (request) => {
    const file = resolve(rendererRoot, `.${decodeURIComponent(new URL(request.url).pathname)}`);
    if (!file.startsWith(`${rendererRoot}${sep}`)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  store = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  const settings = await store.load();
  nativeTheme.themeSource = settings.theme;
  const helperDir = join(app.getPath('userData'), 'helpers');
  await mkdir(helperDir, { recursive: true });
  const helper = join(helperDir, 'ssh-askpass');
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  await writeFile(helper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(__dirname, 'askpass.cjs'))} "$@"\n`, { mode: 0o700 });
  auth = new AuthBroker((challenge: AuthChallenge | null) => {
    if (challenge) tunnel?.authenticating();
    broadcast('auth:challenge', challenge);
  });
  await auth.start();
  tunnel = new TunnelManager({ askpassPath: helper, askpassPort: auth.port, askpassToken: auth.token,
    knownHostsFile: testMode ? process.env.REMOTE_PI_TEST_KNOWN_HOSTS : undefined,
  });
  tunnel.on('state', (state: ConnectionState) => {
    if (state.phase === 'error' || state.phase === 'idle') { auth.cancelAll(); pi.disconnect(); }
    if (state.phase !== 'connected') broadcast('connection:state', state);
  });
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({ width: Math.min(1320, width), height: Math.min(860, height), minWidth: Math.min(520, width), minHeight: Math.min(480, height),
    title: 'Remote Pi', icon: join(__dirname, 'icon.png'), titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 22 },
    backgroundColor: settings.theme === 'dark' ? '#222325' : '#fafafa',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const fitDisplay = () => {
    if (mainWindow.isFullScreen() || mainWindow.isMaximized()) return;
    const bounds = mainWindow.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    mainWindow.setMinimumSize(Math.min(520, area.width), Math.min(480, area.height));
    if (bounds.width <= area.width && bounds.height <= area.height) return;
    const width = Math.min(bounds.width, area.width); const height = Math.min(bounds.height, area.height);
    mainWindow.setBounds({ width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) });
  };
  mainWindow.on('moved', fitDisplay);
  screen.on('display-metrics-changed', fitDisplay);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const devURL = !app.isPackaged ? process.env.REMOTE_PI_DEV_URL : undefined;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devURL ? new URL(url).origin !== new URL(devURL).origin : !url.startsWith('remote-pi://app/')) event.preventDefault();
  });
  registerIPC();
  pi.on('workspace', (packet) => broadcast('pi:workspace', packet));
  pi.on('terminal', (packet) => broadcast('pi:terminal', packet));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Remote Pi', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '刷新 Pi Web', accelerator: 'CmdOrCtrl+R', click: () => broadcast('workspace:refresh', null) }, { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ label: '开发者工具', accelerator: 'Alt+CmdOrCtrl+I', click: () => mainWindow.webContents.toggleDevTools() }] : [])] },
  ]));
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    auth.cancelAll();
    void Promise.resolve(environmentTask).then(() => tunnel.disconnect()).then(() => auth.close()).finally(() => { quitting = true; app.quit(); });
  });
  await mainWindow.loadURL(devURL ?? 'remote-pi://app/index.html');
}

void app.whenReady().then(boot).catch((error) => { dialog.showErrorBox('Remote Pi 启动失败', String(error)); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => { if (!quitting && mainWindow && !mainWindow.isDestroyed()) { event.preventDefault(); mainWindow.close(); } });
