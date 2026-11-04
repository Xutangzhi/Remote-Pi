# Remote Pi

A desktop and Android workspace for your remote Pi coding agents.

[Description](#description) · [Features](#features) · [Quick Start](#quick-start) · [Configuration](#configuration) · [Notes](#notes)

## Description

Remote Pi connects to [Pi Web](https://github.com/jmfederico/pi-web) over SSH and brings conversations, projects, files, Git changes, and terminals into one interface. Agents and development tools run on your server; the desktop and Android apps each connect independently.

The clients share core logic and UI components through npm workspaces, with platform-specific networking, layouts, and input behavior.

```text
apps/desktop/       Electron desktop client and system OpenSSH integration
apps/android/       Capacitor Android client and native SSH integration
packages/core/      Shared protocol types, session state, and input logic
packages/ui/        Shared components and themes
vendor/pi-web/      Pinned upstream Pi Web source
vendor/patches/     Server compatibility and security patches
```

## Features

- **Agent conversations:** streaming replies, Markdown, reasoning and tool output, image attachments, model selection, and conversation history.
- **Projects and subagents:** browse remote projects and workspaces, navigate nested sessions, and track running tasks and unread completions. Child sessions stay collapsed until expanded.
- **Pi input tools:** slash commands, Skills, prompt templates, `@` file and directory completion, `#` model references, and `!` / `!!` shell commands.
- **A complete workspace:** read files, inspect Git changes and diffs, and use interactive terminals alongside chat on wider screens.
- **Drafts and task control:** save text drafts per server and session, recall previous inputs, steer active work, or queue a message for later.
- **Layouts for desktop and mobile:** resizable desktop sidebars, phone drawers and full-screen panels, tablet layouts, keyboard-aware input, and light and dark themes.
- **SSH authentication:** password, key, and interactive authentication with host fingerprint verification. Android stores imported keys encrypted with Android Keystore and carries HTTP/WebSocket traffic through internal SSH channels.

## Quick Start

### Prerequisites

- **For both client builds:** Node.js **22.19 or newer** and npm. Node.js 24 is the documented development baseline.
- **Desktop:** macOS or Linux with system OpenSSH.
- **Android:** JDK **21** and Android SDK **Platform 36**. Android Studio is useful for SDK setup and emulator debugging.
- **Server:** a reachable SSH account and a compatible Pi Web installation. For a new server, follow [Configuration](#configuration) before connecting.

Clone or download this repository, then run client commands from the **repository root**. All client workspaces use the root `package-lock.json`.

```sh
npm ci
```

### Desktop

Start the development app:

```sh
npm run dev
```

To build and run locally, or create an installer:

```sh
npm run build
npm start
npm run dist
```

Installers are written to `apps/desktop/release/`. Use `npm run pack` to produce an unpacked application directory.

### Android

Build the web UI, sync the native project, and generate a debug APK:

```sh
npm run android:build
```

Install `apps/android/android/app/build/outputs/apk/debug/app-debug.apk` on your device or emulator.

For Android Studio, run `npm run android:sync`, then open **`apps/android/android/`**. Use an Android 16 / API 36 emulator to match the primary test environment. Set `ANDROID_HOME` and `JAVA_HOME` if the build script cannot locate your SDK or JDK.

### Connect

Add a server in the app, enter its SSH connection details, and connect. Verify the host fingerprint and complete any authentication prompts. Then select an existing conversation or add a remote project to start a new one.

Both clients connect to Pi Web at the server's `127.0.0.1:<Pi Web port>` through SSH. The default Pi Web port is **8504**; it does not need to be exposed publicly.

## Configuration

### Pi Web server

The compatibility baseline is **Pi Web `1.202610.3`**, commit [`95f5a176647460dbba2847615a31f3d777249e6e`](https://github.com/jmfederico/pi-web/commit/95f5a176647460dbba2847615a31f3d777249e6e), with Pi Coding Agent **1.x**. The original source is included in `vendor/pi-web/` as a regular directory, so no submodule initialization is needed. Client installers do not include the server.

Use a Linux server with systemd user services, Node.js **22.19 or newer**, npm, Git, Python 3, a C/C++ compiler, and make. Install as the account that will run your development tasks. Node.js/npm and provider environment variables must be available to that account's service login shell.

For a **fresh server installation**, place this repository in a permanent directory and run the following from its root:

```sh
git apply --check --directory=vendor/pi-web vendor/patches/yield-to-subsessions.patch
git apply --check --directory=vendor/pi-web vendor/patches/security-dependencies.patch
git apply --directory=vendor/pi-web vendor/patches/yield-to-subsessions.patch
git apply --directory=vendor/pi-web vendor/patches/security-dependencies.patch

cd vendor/pi-web
npm ci --allow-scripts=node-pty
npm run build
npm audit
npm link --ignore-scripts
```

Apply each patch **once**. The yield patch keeps a parent session working while it waits for subagents, preventing premature completion indicators and queued-message delivery. The security patch updates the pinned server dependencies; the preserved upstream snapshot does not include these fixes until the patch is applied.

Allow the `node-pty` native install script under your npm version's script policy. The command above uses `--allow-scripts=node-pty`; if your npm version does not support this flag, follow the [detailed deployment guide](apps/desktop/README.md#pi-web-服务端部署与配置). The npm global prefix must be writable by the current user, and its `bin` directory must be on `PATH`.

Keep this source directory, `dist`, and `node_modules` in place: the linked commands use them at runtime. This installation method preserves the root dependency overrides. Installing the original registry package or a packed tarball globally can resolve the old vulnerable dependencies again. Avoid `pi-web update` until a replacement version and its patches have been verified.

From `vendor/pi-web/`, run `./node_modules/.bin/pi` to configure your model provider credentials. These belong to the **server account**, outside the repository. The default Pi data directory is `~/.pi/agent`; if you set `PI_CODING_AGENT_DIR`, use the same value for sessiond.

Create `~/.config/pi-web/config.json`, or merge these settings into an existing configuration:

```json
{
  "host": "127.0.0.1",
  "port": 8504,
  "spawnSessions": true,
  "subsessions": true,
  "askUser": true,
  "plugins": {
    "git": { "enabled": true }
  }
}
```

The Git panel requires the bundled Git plugin. Terminals use the bundled `pi-web.terminal` plugin and paired channel v1. Skills, templates, and extensions are loaded from the server account or remote project; local desktop or phone files are not synchronized automatically.

For a **new installation**, create the user services and verify health:

```sh
pi-web install --host 127.0.0.1 --port 8504
pi-web doctor
pi-web status
curl --fail http://127.0.0.1:8504/api/sessiond/health
```

For an **existing installation**, wait until all sessions, subagents, terminals, and background tasks have finished before replacing server dependencies or restarting `pi-web.service` and `pi-web-sessiond.service`. Updating a client does not apply server patches or restart these services.

### Client connection profiles

| Setting | Desktop | Android |
| --- | --- | --- |
| Server name | A label for the connection | A label for the connection |
| Host | IP address, hostname, or SSH configuration alias | Reachable IP address or hostname |
| SSH username | Optional; can inherit OpenSSH configuration | Required |
| SSH port | Optional; can inherit OpenSSH configuration | Defaults to `22` |
| Pi Web port | Defaults to `8504` | Defaults to `8504` |
| Private key | Optional local key path; existing SSH agent/configuration can also be used | Optional key imported through the app |

Desktop uses system OpenSSH, including `~/.ssh/config`, ProxyJump, and ssh-agent. Android uses its own SSH implementation and does not import those desktop settings. Private servers require a network route from the device, such as the same network or an existing VPN.

Passwords, key passphrases, and verification codes are not persisted. Desktop stores profile metadata and theme settings in Electron's user data directory. Android stores imported private keys encrypted with Android Keystore.

## Notes

### Compatibility and behavior

- **Desktop:** macOS Apple Silicon has been tested. Linux AppImage configuration is included, but Linux has not been validated on a physical machine. macOS installers are not developer-signed or notarized.
- **Android:** Android 16 / API 36 is the primary validation target. The declared minimum is Android 7 / API 24, but that does not imply full testing on older devices. Keep Android System WebView current; Chrome 117 or newer is the visual baseline. APKs built by the quick start use a debug signing key.
- **Mobile background work:** Android has no always-on foreground service or background notification guarantee. The app may need to reconnect when resumed. Agent tasks continue on the server.
- **Task lifetime:** disconnecting or closing a client does not stop remote agents or terminal processes. Restarting sessiond can interrupt them. Desktop's environment refresh requires Linux, Python 3.8+, and the two systemd user services; Android does not offer this action.
- **Input:** desktop Enter sends and Shift+Enter inserts a newline. On Android, Enter inserts a newline; use the send button or Ctrl/Cmd+Enter on an external keyboard. `@` references point to remote files.
- **Scope:** file previews and Git diffs are read-only. The clients target direct Pi Web access over SSH; reverse proxies with an extra HTTP authentication layer are not part of the connection flow. New Pi Web versions and third-party plugin interfaces need compatibility checks.

### 文件预览

Mac 和安卓可从聊天里的文件链接或文件面板打开以下只读预览：

- 表格：CSV、TSV、XLSX、XLS、ODS；支持切换工作表、横向滚动，保留文本编号及文件中保存的公式结果，不重新计算公式。CSV／TSV 使用 UTF-8 编码。
- 视频：MP4、M4V、WebM、OGV、MOV；音频：MP3、WAV、M4A、AAC、OGG、Opus、FLAC。提供播放、暂停及进度控制，不自动播放；实际可播放编码取决于 Electron／Android WebView，无法解码时显示错误。
- 文档：PDF、DOCX（Word）、PPTX（PowerPoint）；支持上一页／下一页、适合宽度及放大。PDF 使用本地 PDF.js 渲染；Word 按保存的分页展示文字、表格和图片；PPTX 为静态幻灯片预览。复杂排版、缺失字体、动画和嵌入媒体可能与 Office 原件不同。
- 图片：PNG、JPEG、GIF、WebP、SVG、BMP；原有 Markdown 阅读视图、原文切换及文本／代码预览继续保留。

表格最多读取 10 MiB，显示前 20 个工作表，每表前 1000 行、50 列，单元格最多 2000 字符；超出时提示截断。图片及文档上限 20 MiB，音视频上限 128 MiB。音视频完整加载后播放，暂不提供远端分段流播放。表格解析在 Web Worker 中运行，15 秒超时后停止。

文件使用现有 SSH 连接及 Pi Web 的 `file/preview?download=1` 接口读取，仍遵守服务器的工作区与允许路径限制。Mac 通过应用内部协议传输；安卓先写入应用私有缓存，再交给 WebView，切换／关闭预览会取消读取、释放媒体资源并删除安卓缓存。此能力不需要额外服务端补丁。未支持的二进制文件会明确提示，旧版 DOC／PPT 会提示转换为 DOCX／PPTX／PDF；不渲染 HTML。加密文档须先解锁。Word／PPTX 最多 200 页；PPTX 解压总量限制 100 MiB，解析超过 20 秒会停止。

文档预览使用固定版本的 [PDF.js](https://github.com/mozilla/pdf.js) 5.4.624、[docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.1、[@office-kit/pptx](https://github.com/office-kit/pptx) 0.28.0 和 pptx-preview 0.21.0；依赖、字符映射及解码器随客户端打包，不依赖第三方在线文档服务。Word 在禁止脚本的隔离框架中显示；PPTX 在 Worker 中解析并作为图片展示。许可证见 `packages/ui/DOCUMENT_PREVIEW_LICENSES.txt`，随两端安装包分发。

表格解析使用 [SheetJS Community Edition 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)，依赖固定为官方 CDN 包；Apache 2.0 许可证随桌面安装包及安卓第三方声明一起分发。

### Development and verification

Run these commands from the repository root:

```sh
npm test                     # Shared and platform-specific logic
npm run test:e2e              # Desktop Electron end-to-end tests
npm run test:ui:android       # Phone and tablet UI tests
npm run test:native:android   # JVM SSH and HTTP/WebSocket tests
npm run test:device:android   # Tests on a running emulator or connected device
```

Android UI tests require a Playwright browser: run `npx playwright install chromium --only-shell`, or use `PLAYWRIGHT_CHANNEL=chrome npm run test:ui:android` with an installed Chrome. The device suite installs test builds and requires Android 11 / API 30 or newer. Normal test suites use local fixtures and exclude the opt-in real-server test.

See the [desktop guide](apps/desktop/README.md) and [Android guide](apps/android/README.md) for platform details and validation history; these extended guides are currently in Chinese. SDKs, AVDs, local configuration, credentials, signing keys, dependencies, and generated builds should remain outside version control.

### Acknowledgments and license

Remote Pi is built on **[Pi Web](https://github.com/jmfederico/pi-web)** by **Federico Jaramillo Martinez** and its contributors. Their work provides persistent sessions, subagents, project management, real-time events, and plugin and terminal services. Thanks also to the maintainers and contributors of **[Pi Coding Agent](https://github.com/earendil-works/pi)** for the agent runtime.

Remote Pi is licensed under the [MIT License](LICENSE). The vendored Pi Web source retains its original [MIT license and copyright notice](vendor/pi-web/LICENSE). Additional Android notices are in [OPEN_SOURCE_LICENSES.txt](apps/android/OPEN_SOURCE_LICENSES.txt). See the [vendor documentation](vendor/README.md) for source provenance and update instructions.

Remote Pi is an independent client and is not officially affiliated with Pi Web, Pi Coding Agent, or OpenAI.
