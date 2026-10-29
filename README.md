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
