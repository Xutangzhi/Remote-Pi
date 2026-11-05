import { BrowserWindow, WebContentsView, nativeTheme } from 'electron';

function validWebURL(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}

// This trusted shell stays visible even when the remote renderer fails or crashes.
const shell = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Remote Pi · Browser</title><style>
:root { color-scheme:light; --bg:#fafafa; --text:#303133; --muted:#66686d; --border:#dddfe2; --accent:#4d6d55; --fill:#d9e8d1; --on-accent:#3c5944 }
@media (prefers-color-scheme:dark) { :root { color-scheme:dark; --bg:#222325; --text:#ececee; --muted:#abaeb3; --border:#3d3f44; --accent:#b0caa5; --fill:#b8cfae; --on-accent:#233228 } }
* { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:13px 'Avenir Next',system-ui }
header { height:56px; display:flex; align-items:center; gap:16px; padding:8px 16px; border-bottom:1px solid var(--border) }
button { flex-shrink:0; min-height:36px; padding:8px 12px; border:1px solid var(--border); border-radius:12px; background:var(--fill); color:var(--on-accent); cursor:pointer; font:inherit; transition:background 160ms }
button:hover { background:color-mix(in srgb,var(--fill) 90%,var(--text)) } button:focus-visible { outline:2px solid var(--accent); outline-offset:2px }
#address { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--muted) }
main { padding:32px } h1 { font-size:18px } #status { overflow-wrap:anywhere; line-height:1.6 }
@media (prefers-reduced-motion:reduce) { button { transition:none } }
</style></head><body><header><button type="button" id="close">关闭网页 · 返回聊天</button><span id="address"></span></header>
<main><h1>网页预览</h1><p id="status" role="status">正在加载网页…</p></main>
<script>document.getElementById('close').addEventListener('click', () => window.close());</script></body></html>`;

export async function openWebPage(mainWindow: BrowserWindow, url: string, backgroundTests: boolean): Promise<void> {
  if (!validWebURL(url)) return;
  // A standalone window avoids covering a fullscreen chat as a native child window.
  const browser = new BrowserWindow({ width: 1040, height: 760, minWidth: 480, minHeight: 240, title: 'Remote Pi · Browser',
    show: false, focusable: !backgroundTests, fullscreenable: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#222325' : '#fafafa',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }, });
  const page = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'remote-pi-web-pages' } });
  browser.contentView.addChildView(page);
  page.setVisible(false);
  const resize = () => { const [width, height] = browser.getContentSize(); page.setBounds({ x: 0, y: 56, width, height: Math.max(0, height - 56) }); };
  browser.on('resize', resize); resize();
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browser.webContents.on('will-navigate', (event) => event.preventDefault());
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  page.webContents.on('will-navigate', (event, next) => { if (!validWebURL(next)) event.preventDefault(); });
  page.webContents.on('will-redirect', (event, next) => { if (!validWebURL(next)) event.preventDefault(); });
  page.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  let failed = false;
  const fail = (message: string) => {
    if (browser.isDestroyed()) return;
    failed = true;
    page.setVisible(false);
    void browser.webContents.executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(message)}; document.getElementById('status').setAttribute('role', 'alert');`).catch(() => {});
  };
  page.webContents.on('did-start-navigation', (event) => { if (event.isMainFrame) failed = false; });
  page.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) fail(`网页加载失败：${description}。请关闭网页返回聊天。`);
  });
  page.webContents.on('render-process-gone', () => fail('网页进程已退出。请关闭网页返回聊天后重新打开。'));
  page.webContents.on('did-finish-load', () => { if (!failed && !browser.isDestroyed()) page.setVisible(true); });
  const close = () => { if (!browser.isDestroyed()) browser.close(); };
  mainWindow.once('closed', close);
  browser.on('closed', () => {
    mainWindow.removeListener('closed', close);
    if (!page.webContents.isDestroyed()) page.webContents.close();
    if (!backgroundTests && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  });
  try {
    await browser.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(shell)}`);
    if (browser.isDestroyed()) return;
    await browser.webContents.executeJavaScript(`document.getElementById('address').textContent = ${JSON.stringify(url)};`);
  } catch (error) {
    if (browser.isDestroyed()) return;
    browser.close(); throw error;
  }
  if (browser.isDestroyed()) return;
  if (!backgroundTests) browser.show();
  void page.webContents.loadURL(url).catch((error: Error) => { if (!error.message.includes('ERR_ABORTED')) fail(`网页加载失败：${error.message}。请关闭网页返回聊天。`); });
}
