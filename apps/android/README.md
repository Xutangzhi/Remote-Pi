# Remote Pi for Android

Remote Pi 统一仓库中的 Android 客户端，源码位于 `apps/android/`，与桌面版共用 `packages/core/` 和 `packages/ui/`。当前版本 **0.2.4（versionCode 6）**，主要验证目标为 **Android 16（API 36）**。SSH 认证、隧道和工作台均在 App 内完成，不依赖桌面 App 或手机上的第三方 SSH 工具。

0.2.4 保留 0.2.3 的功能与 UI，将 HTTP/WebSocket 改为应用内部的 SSH 通道，不再开放手机本地转发端口，并更新构建依赖。统一命令和目录说明见[仓库首页](../../README.md)。后续开发使用本目录，原 `Remote-Pi-Android` 目录仅保留为迁移前副本。

0.2.3 与桌面端统一为灰白底色，淡绿色仅用于主要按钮、关键图标和焦点提示；深色模式保留中性深灰背景。

## 使用

1. 在服务器上启动现有的 Pi Web，确认 SSH 用户能访问服务器的 `127.0.0.1:8504`。若实际端口不同，在 App 的「端口与私钥设置」中修改。
2. 安装 `Remote-Pi-Android-0.2.4-debug.apk`。手机可能要求允许当前文件管理器安装应用；本包使用 Android 调试签名，供个人测试。
3. 添加服务器地址、SSH 用户名及端口。使用密码认证时无需导入私钥；使用密钥认证时，从手机文件中选择自己的私钥。
4. 点击「连接工作台」，核对并信任首次连接的主机指纹，按提示输入密码、私钥口令或验证码。
5. 打开项目抽屉，选择项目、工作区和原有会话，也可以添加项目或创建新会话。项目目录位于服务器上。

不需要将 Pi Web 端口开放到公网；手机只需能够访问服务器的 SSH 端口。内网服务器需要手机接入相同网络或已有 VPN。App 不会替你安装或启动服务器上的 Pi Web。

## 已实现

- 原生 SSH 密码、私钥及交互式认证，应用内部 SSH 通道，首次主机指纹确认和已知主机记录；主机密钥变化时拒绝连接。
- 多服务器配置、手机私钥文件导入；导入的私钥以 Android Keystore 保护的 AES-GCM 加密保存。密码、口令和验证码不持久保存。
- 手机项目抽屉、项目/工作区切换、创建和继续会话、模型与思考等级选择、流式回复、工具调用、图片附件与预览。
- `/` 命令、Skills、提示词模板、`@` 文件与目录补全、`#` 模型引用、`!` / `!!` Shell 命令，以及命令选择框、会话分叉和历史导航。
- 子 Agent 列表默认折叠，点击箭头后展开；再次打开侧栏会定位当前会话及其必要的父级。运行中显示蓝点，完成未查看显示红点，侧栏按钮优先提示未读完成状态。
- 执行中的会话可选择「排队发送」或「立即引导」。等待子 Agent 的运行状态和消息队列由远端服务决定，见下方 `yield_to_subsessions` 兼容说明。
- 按服务器和会话隔离的文字草稿会保存到本机，重新打开 App 可恢复；切换会话不会解除另一会话的发送锁。图片附件只保留在当前进程内，不随文字草稿持久化。
- 文件浏览与预览、Git 变更/Diff、远端终端在手机窄屏中全屏打开；宽屏平板可与聊天并存，并按窗口宽度调整布局。系统返回键优先关闭当前面板、抽屉或对话框。
- 亮色/暗色主题、圆角与清晰边界、平滑抽屉过渡、系统减少动态效果适配，以及 Android 16 系统栏、挖孔与软键盘避让。已移除打开原始 Pi Web 界面的 UI 入口。

## 输入、命令与 Skills

| 输入 | 行为 |
| --- | --- |
| `/` | 显示当前会话从服务器读取的内置命令、扩展命令、提示词模板和 Skills。 |
| `/skill:` | 筛选服务器已加载的 Skills，例如 `/skill:review 检查当前改动`。 |
| `/模板名 参数` | 调用服务器已加载的提示词模板，参数按 Pi 的规则处理。 |
| `@路径片段` | 优先补全当前远端工作区的真实路径，精确同名目录排在前面。明确的路径不会回退到 `.cache` 中的同名副本；普通名称没有路径匹配时才模糊搜索已跟踪文件。 |
| `@ ` / `!@` | 将文件搜索范围扩展为全部文件，包含未跟踪文件。带空格的路径自动加引号。 |
| `#模型片段` | 补全 `#provider/model-id` 引用；切换会话模型使用底部模型选择器或 `/model`。 |
| `!命令` / `!!命令` | 在服务器上执行 Shell 命令；`!!` 按 Pi 规则不将输出加入模型上下文。 |

手机输入框按 **Enter 换行**，点击发送按钮发送；外接键盘可用 **Ctrl/Cmd+Enter**。补全列表可点击选择，也支持 ↑ / ↓、Tab / Enter 接受和 Esc 关闭；列表打开时 Enter 接受补全，不发送消息。外接键盘在输入开头/结尾按 ↑ / ↓ 可切换历史输入，中文输入法确认候选字不会误发送。

`/model`、`/new`、`/resume` 使用 App 内的界面；其余命令交给 Pi Web 处理。`/fork` 的选项、`/clone` 返回的新会话、`/tree` 的导航与分叉，以及服务端返回的草稿均在 App 内处理。服务器不支持的命令会报错并保留输入，不会改为普通模型消息发送。

Skills、模板和扩展需要先配置到**服务器运行用户或当前项目**，客户端不会同步手机或电脑上的本地 Skills。修改后可在空闲会话执行 `/reload`，并遵守 Pi Web 的工作区信任规则。`@` 引用指向远端文件，不会上传手机同名文件。

## Pi Web 兼容性

协议基线与桌面版相同：Pi Web `1.202610.3`，上游提交 [`95f5a176647460dbba2847615a31f3d777249e6e`](https://github.com/jmfederico/pi-web/commit/95f5a176647460dbba2847615a31f3d777249e6e)。Git 与终端依赖服务器启用对应插件；终端需要 paired channel v1。不同版本的历史快照、命令及插件接口可能不兼容，升级服务端后应重新验证。

`yield_to_subsessions` 表示父会话等待子 Agent，不是整个任务完成。App 根据服务端 `core:working` 与未读目录显示蓝点/红点，并提交排队消息的发送方式；**队列何时消费、等待期间是否保持运行，仍由 Pi Web / Pi 运行时负责**。需要本仓库的 [`yield_to_subsessions` 补丁](../../vendor/patches/yield-to-subsessions.patch) 或具备等效修复的服务端，才能避免 yield 后提前变红或发送排队消息。仅升级 Android APK 不会给服务器应用补丁，也不会重启 Pi Web/sessiond。

Android APK 不打包 Pi Web 服务端源码；统一仓库在 `vendor/pi-web/` 保留固定版本源码。部署时还需应用[安全依赖补丁](../../vendor/patches/security-dependencies.patch)，并按[完整部署说明](../desktop/README.md#pi-web-服务端部署与配置)使用源码安装流程，使依赖覆盖生效。仅更新 APK 不会修复已有服务器的依赖。来源与更新方式见[上游源码说明](../../vendor/README.md)，或 [Pi Web 上游文档](https://github.com/jmfederico/pi-web)。保持服务只监听服务器 `127.0.0.1`，通过 App 的 SSH 隧道访问。

## 技术结构

React + TypeScript + Vite 负责手机工作台；Capacitor 8 承载 Android App；Java 原生插件使用 JSch、Bouncy Castle 与 OkHttp 实现 SSH、HTTP/WebSocket 和密钥存储。Pi Web 协议适配层直接调用服务器接口，聊天界面不是嵌入原始 Pi Web 页面。

OkHttp 通过 JSch `direct-tcpip` 通道访问服务器的 `127.0.0.1:<Pi Web 端口>`，不在 Android 设备上创建 TCP 监听端口；每次 SSH 连接使用独立的客户端与连接池。正常取消请求只关闭对应通道；如果底层写入阻塞，导致通道在 500 ms 内无法清理，则关闭该次 SSH 连接并提示重新连接，避免取消操作卡死。原始 Pi Web 页面跳转接口已移除，普通 HTTPS 外链仍可打开。

以下路径相对于 `apps/android/`；有差异的手机布局、输入和原生交互继续由 Android 工作区维护。

- `../../packages/core/`、`../../packages/ui/`：共用类型、会话/输入逻辑、界面组件与主题。
- `src/renderer/`：连接页面、手机适配、项目/聊天/文件/Diff/终端界面。
- `src/platform/`：Capacitor bridge、Pi Web 协议适配和原生 WebSocket 适配。
- `android/app/src/main/java/dev/remotepi/android/`：SSH、私钥存储、网络传输及 Android 系统集成。
- `tests/`、`android/app/src/test/`、`android/app/src/androidTest/`：会话/输入逻辑、手机与平板布局、原生 SSH/传输及设备测试。

## 构建

需要 Node.js 22.19.0+、JDK 21、Android SDK Platform 36，以及可下载依赖的网络。项目 compile/target SDK 均为 36；Manifest 允许最低 Android 7.0（API 24），实际主要测试平台是 Android 16，不能据最低 SDK 推断旧手机已完整兼容。

请将 **Android System WebView 更新到设备支持的最新版本**。完整视觉效果以 Chrome 117 或更新的内核为基线，UI 使用 `color-mix()`，部分过渡使用 `@starting-style` 等渐进增强；构建脚本的 JavaScript 转译目标不代表所有 CSS 和 Web API 都兼容同版本内核。旧系统无法更新到足够新的 WebView 时，布局和交互需要单独验证。

在 **Remote Pi 仓库根目录**执行，使用根目录的唯一 lockfile 安装工作区依赖：

```sh
npm ci
npm run android:build
```

macOS 默认使用 `~/Library/Android/sdk`；其他位置设置 `ANDROID_HOME`。脚本在 macOS 上会优先寻找 JDK 21，其他系统请自行设置 `JAVA_HOME`。首次构建可能需要先在 Android Studio 的 SDK Manager 中安装 SDK 并按需接受许可。

APK 生成在：`apps/android/android/app/build/outputs/apk/debug/app-debug.apk`。

也可以在根目录执行 `npm run sync --workspace apps/android` 后，在 Android Studio 中打开 **`apps/android/android/`**，在 Device Manager 选择已安装的 Android 16 / API 36 模拟器，或连接手机运行。发布到应用商店需要另行配置自己的正式签名。

新克隆的源码不包含本机 AVD；在 Android Studio Device Manager 创建 Android 16 / API 36 设备即可。SDK、AVD、`local.properties`、签名密钥以及 `.gradle` / `build` 等缓存和构建产物不提交到 Git。Gradle wrapper 随源码保留；前端资源与 Capacitor 插件目录由 `npm run sync --workspace apps/android` 重新生成。

## 验证

以下命令在仓库根目录执行：

```sh
npm test                      # 公共逻辑及两端逻辑测试
npm run test:native:android    # 启动本地真实 SSH 服务，执行 Java SSH 和 HTTP/WebSocket 测试
npx playwright install chromium --only-shell
npm run test:ui:android        # 手机/平板视口、抽屉、补全、草稿、面板与键盘流程
```

本机已安装 Chrome 时也可执行：`PLAYWRIGHT_CHANNEL=chrome npm run test:ui:android`。

完整设备套件需要 **Android 11（API 30）或更新** 的测试设备，Android 16 / API 36 是本轮主要目标。启动模拟器或连接设备后执行 `npm run test:device:android`。脚本构建并安装测试包，临时启动本机 SSH/Pi Web 测试服务，通过 ADB reverse 运行 6 项设备测试，覆盖 Keystore、密码/加密 Ed25519 私钥认证、隧道 HTTP/WebSocket，以及系统栏/挖孔/软键盘 inset 只应用一次和收起后恢复。真实 WebView 测试还会通过原生桥连接本地 SSH 夹具，打开会话并触摸唤起软键盘，检查聊天输入框边界、返回收键盘、横竖屏切换和深浅主题系统栏。结束后关闭测试服务并移除临时转发。多个设备时使用 `ANDROID_SERIAL=<序列号> npm run test:device:android`。

JVM 原生测试还覆盖首次信任、重复连接、主机密钥变化、取消连接、HTTP 不跟随重定向、单次请求超时及 WebSocket 二进制 JSON。普通请求超时为 30 秒，命令与会话树操作允许最长 300 秒，避免耗时命令被普通请求期限提前打断。

常规 UI 和设备套件使用本地测试服务器数据。真实服务器验收另由 `RealServerTest` 显式执行：仅在应用私有目录存在操作者提供的 `real-test-input.json` 时运行，普通 `test:device:android` 会排除此测试。连接资料不进入源码或安装包；临时明文输入立即删除，导入私钥由 Keystore 加密保存。真实测试使用独立会话，只读浏览文件/Git；终端仅在工作区没有现存运行终端时创建测试 shell，并在验证后退出。不同厂商的文件选择器、真实输入法和后台行为仍需真机验证。

2026-10-30，0.2.4 的逻辑和 UI 测试、20 项 JVM 原生传输测试及 6 项 Android 16 / API 36 设备测试全部通过，原生测试无跳过。8 张手机浅/深色基线截图逐像素一致；APK 的版本、v2 签名与许可副本校验通过。设备测试前后原有连接资料、加密私钥和已知主机记录保持一致；本轮未向真实服务器发送模型消息。

2026-10-29，0.2.0 的 23 项 JavaScript 逻辑测试、12 项 JVM SSH/传输测试、6 项手机/平板 UI 测试和 6 项 Android 16 设备测试全部通过。设备测试实际运行于本机 Android Studio Running Devices 中的 `RemotePiAndroidTest`（Android 16 / API 36 / arm64）。

同日 0.2.1（versionCode 3）使用桌面端现有连接资料完成真实服务器验收：独立聊天收到预期回复，文件内容与接口返回一致，Git 可查看已修改文件和未跟踪文件的差异，终端输入与输出正常。真实触屏验证了文件/Git 长行左右滑动，以及终端软键盘弹出、视口避让和返回收起。修复了只有未跟踪文件时汇总差异为空却显示“暂无变更”的误导提示，改为提示选择文件查看新增差异，并增加相应 UI 回归用例。0.2.1 的 23 项逻辑测试、7 项 UI 测试和 6 项常规设备测试全部通过，APK v2 签名校验通过。

实际服务器的旧版 Git 不支持 Pi Web 使用的 `git worktree list --porcelain -z`，服务端会降级返回主工作区；主工作区的聊天、文件、Git Diff 和终端可用。完整多工作区枚举需要服务端使用支持该选项的 Git，本轮未变更服务器软件或服务配置。

## 当前边界

- 使用 App 内 JSch 原生 SSH，支持直接连接；不会读取或导入电脑上的 `~/.ssh/config`、ssh-agent 或 ProxyJump。服务器地址、用户名、端口及手机导入的私钥需在 App 中明确配置。
- 没有前台常驻服务、后台通知或后台不断线保证。系统可能关闭后台网络；回到前台时会检查并尝试重连，可能需要再次输入认证信息。远端 Pi Web 中的任务由服务器继续执行。
- 主机密钥改变后需要先向管理员核对；当前没有直接忽略主机密钥变化的按钮。
- 当前提供调试签名 APK，尚未完成安卓真机与实际服务器的联合验收。
- 没有桌面版的「刷新远端环境」功能；App 不修改远端代理、Docker 权限或 systemd 服务配置。文件预览和 Git Diff 为只读，尚未移植 Pi Web 所有插件 UI。

## 致谢与许可证

感谢 **[Pi Web](https://github.com/jmfederico/pi-web)** 作者 **Federico Jaramillo Martinez** 及贡献者提供远端项目、持久会话、子 Agent、实时事件与插件/终端能力，也感谢 **[Pi Coding Agent](https://github.com/earendil-works/pi)** 的维护者与贡献者提供 Agent 运行时。Android 客户端通过 Pi Web HTTP/WebSocket 协议使用这些能力，并保留输入补全相关的上游许可声明。

Remote Pi 自身采用 [MIT License](../../LICENSE)。第三方组件与 Pi Web 的许可声明保留在 [OPEN_SOURCE_LICENSES.txt](OPEN_SOURCE_LICENSES.txt)，同一文件随 APK 打包到 `assets/OPEN_SOURCE_LICENSES.txt`。Remote Pi 是独立客户端，与 Pi Web、Pi Coding Agent 及 OpenAI 无官方关联。
