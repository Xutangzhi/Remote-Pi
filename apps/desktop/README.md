# Remote Pi Desktop

通过 App 内的 SSH 连接，操作服务器上的 Pi Agent。0.2 版本使用独立 React 工作台直接调用 Pi Web API；项目、对话和工具执行均来自远端服务。

桌面源码位于统一仓库的 `apps/desktop/`，与 Android 共用 `packages/core/` 和 `packages/ui/`。当前版本为 **0.2.25**，在保留 0.2.24 功能与 UI 的基础上更新安全依赖、限制图片下载内存，并避免环境刷新失败后中断新任务；统一命令和目录说明见[仓库首页](../../README.md)。

## 工作台

0.2.24 将桌面端与 Android 端统一为白灰底色，淡绿色仅点缀主要按钮、图标与输入焦点；深色模式使用中性深灰，侧栏、正文和代码块保持灰白层次。保留蓝色运行状态、红色完成提醒及错误语义。继续保留阅读字体、细边框和圆角、平滑过渡，并响应系统“减少动态效果”设置。字体使用本机字体回退，不加载远程字体。

- 左侧按「项目 → 主会话 → Subagent 子会话」组织，按服务端 `parentSessionPath` 保留多层父子关系。子会话默认折叠，点击箭头展开 / 收起，选择会话不会自动展开其子 Agent；搜索和归档筛选保留父会话上下文。支持创建对话、重命名、归档与恢复。
- 添加服务器上的目录作为项目；可选择创建不存在的目录，随后开启对话。信任目录中的扩展与配置需要单独勾选。
- 项目有多个工作区时，可在新建对话时选择工作区。
- 会话和 Subagent 运行时显示蓝点，结束但尚未查看时显示红点。成功打开聊天记录后标记已读；如果正在前台查看该会话，其结束记录会自动视为已读。窗口失焦、聊天加载失败或弹窗遮挡时不自动清除。
- 状态来自 Pi Web 的机器运行状态与服务端未读目录，实时推送之外，窗口可见时每 5 秒重新校验，切回窗口或重新显示时立即校验，避免漏掉结束推送后蓝点不消失。重连后恢复状态；已读确认携带目录版本和完成序号，防止旧请求误清除新的任务完成记录。
- 中间展示 Markdown 历史、思考过程、图片和可展开的工具调用；支持分页读取旧消息。消息原文、代码块和工具输出均可复制，并显示成功或失败反馈；图片加载失败会明确提示。远端图片按流执行 20 MiB 下载上限，超过上限立即取消读取；错误响应和断线也会取消数据流。停留在底部时随布局和内容变化跟随最新内容，向上阅读历史时保留阅读位置。
- 流式输出、任务停止、排队发送与立即引导；断线后重新读取快照并按事件序号恢复，避免重复消息。0.2.4 修正代理转发的二进制 JSON 帧解码，聊天、状态与终端均兼容文本和二进制帧。0.2.5 合并用户消息的临时回显和后续确认，避免一次发送显示多个气泡；真实重复发送、不同图片和断线恢复仍分别保留。
- 侧栏「刷新远端环境」通过新的 SSH 连接读取登录交互 Shell 的代理变量，同步后重启 Pi Web 和 sessiond，再检查健康及实际进程环境并恢复对话。检测到运行中的会话、子任务或服务下挂载的终端/后台进程时拒绝重启；失败自动恢复原代理配置。恢复配置后会重新确认任务和后台进程空闲；若出现新任务或状态无法确认，保留当前服务，不再次重启，并提示等待空闲后重新刷新。只同步代理变量，不导入整个终端环境。0.2.7 兼容通过 `sg docker` 启动的守护进程，识别启动父进程与其直接 Node 子进程，避免误判为残留后台任务。
- 文字草稿按服务器和会话保存在本机，刷新或重启 App 后恢复，并记住上次打开的会话；发送成功后清除对应文字草稿。图片附件仅保留在当前 App 运行期间，退出前请先发送或另行保留。会话重连期间仍可编辑文字，连接恢复前不会提交消息。
- 模型和思考强度直接读取远端能力；支持上传、拖入和粘贴图片（PNG / JPEG / GIF / WebP，单张最多 10 MB）。
- 扩展确认框和 `ask_user` 提问在聊天中呈现，由用户回答。
- 异步发送状态按会话保留，切走再切回不会重复发送，发送完成只清除原先提交的草稿，命令恢复的新草稿会保留。文件读取在刷新、目录或面板切换后忽略过期响应；终端连接完成时保持用户当前输入焦点。
- 右侧文件浏览与预览、Git 差异、xterm 终端以常驻分栏形式按需打开，保留滑动效果，不遮罩或模糊聊天区。宽窗口左右并排，窄窗口上下分区，可同时操作终端和编辑 Agent 消息。文件预览和 Diff 为只读；终端通过 Pi Web Terminal 插件执行远端操作。
- 输入框随窗口和侧栏宽度自动适应换行高度。编辑已有文件、命令或模型引用的中间部分时，补全替换完整引用并保留后续正文。新建、重命名和命令选择对话框会限制键盘焦点在框内，关闭后返回原控件，避免向背景会话误发消息。
- 左右侧栏边缘可拖动调整宽度，悬停侧栏同样可调；窄屏下右侧面板改为拖动上边缘调整高度。尺寸保存在本机，窗口变小时自动限制大小以保留聊天空间；双击分隔线恢复默认，也可聚焦分隔线后用方向键调整。
- 浅色与深色主题，侧栏可收起。收起后将鼠标移近窗口左边缘短暂停留即可临时展开，抽屉以磨砂玻璃效果滑出，背景遮罩渐暗；鼠标移出后平滑滑回，聊天区不随悬停展开而移动。点击按钮展开为与聊天并排的常驻侧栏，保留滑动效果，不遮罩或模糊聊天区；切换对话、移开鼠标和调整窗口大小均保持展开，点击收起按钮时平滑滑回。按钮或悬停展开时都会恢复当前对话对应的搜索 / 归档视图，展开必要父级并滚动到当前对话，当前对话下的子 Agent 仍默认折叠。侧栏展开 / 收起按钮汇总所有会话状态：未读完成红点优先，其次是运行蓝点；完成对话成功标为已读后才移除相应红点，打开侧栏本身不会清除未读状态。⌘ / Ctrl + N 新建对话，Enter 发送，Shift + Enter 换行。

### 输入框、命令与 Skills

输入框直接使用当前服务器和当前会话的能力，不需要打开原版 Pi Web 页面：

| 输入 | 行为 |
| --- | --- |
| `/` | 列出服务端返回的内置命令、扩展命令、提示词模板和 Skills，显示说明、来源及参数提示；继续输入可筛选。 |
| `/skill:` | 筛选当前会话可用的 Skills。选择后，例如 `/skill:review 检查当前改动`，由远端 Pi 加载技能并执行；客户端不会把它当成普通文本命令交给模型猜测。 |
| `/模板名 参数` | 调用服务器已加载的提示词模板，参数按 Pi 的规则处理。扩展注册的命令同样使用服务端命令接口。 |
| `@路径片段` | 优先按当前远端工作区的实际路径补全文件与目录，精确同名目录排在首位，输入尾随 `/` 时只列该目录的直接内容；明确路径不会匹配到 `.cache` 等其他位置的同名副本。普通名称没有路径前缀匹配时，才模糊搜索已跟踪文件。`@ `（后面加空格）或 `!@` 将模糊搜索范围扩展为全部文件，包括未跟踪文件；带空格的路径自动加引号。 |
| `#模型片段` | 补全 `#provider/model-id` 模型引用；直接切换当前会话模型使用底部模型选择器或 `/model`。 |
| `!命令` / `!!命令` | 通过 Pi 的 Shell 接口执行远端命令；`!!` 按 Pi 规则将输出排除在模型上下文之外。 |

补全菜单支持 ↑ / ↓ 选择、Tab / Enter 接受、Esc 关闭；接受补全后再次 Enter 才提交，Shift + Enter 换行，中文输入法确认候选字不会触发提交。文件引用指向服务器上的路径，不会上传本机同名文件；服务器仍执行自身的文件访问策略。

`/session`、`/name`、`/compact`、`/reload` 等命令由 Pi Web 处理；`/model`、`/new`、`/resume` 使用 Remote Pi 的原生选择界面。`/fork` 的选择框、`/clone` 返回的新会话、`/tree` 的历史导航与分叉也在客户端内完成，并保留服务端返回的草稿。扩展命令所需的确认、选择或文本输入沿用聊天中的扩展交互框。远端尚未实现或当前状态不允许的命令会显示错误并保留输入，不会回退成普通模型消息。

Skills 和提示词模板必须先按 Pi 的方式安装或配置到**服务器运行用户 / 当前项目**；客户端不会将本机的 Skills 自动同步到服务器。新增或修改普通 Skills、模板及扩展后，在空闲会话执行 `/reload`，再输入 `/skill:` 查看最新目录；项目资源还需满足 Pi Web 的工作区信任规则。服务端插件和全局 Provider 的重启要求见后文部署说明。

SSH 指纹确认、密码、私钥口令和验证码均在 App 内完成。客户端使用系统 OpenSSH，沿用 SSH 配置别名、ProxyJump 和 ssh-agent。密码和口令不保存在配置中。

## 开发与构建

需要 Node.js ≥ 22.19（建议 24）、npm、系统 OpenSSH，以及 macOS 或 Linux。以下命令均从 **Remote Pi 仓库根目录**执行，依赖通过根目录的 lockfile 统一安装。

```bash
npm ci
npm run dev
```

界面支持热更新；修改 `apps/desktop/src/main/` 后重新运行。首次安装需要下载 Electron。

```bash
npm run build
npm start
npm run pack  # 生成应用目录
npm run dist  # 生成安装包
```

默认输出在 `apps/desktop/release/`。可用 `npm run dist --workspace apps/desktop -- --config.directories.output=release/0.2.25` 单独保存新版。Linux AppImage 构建配置已提供，尚未在 Linux 实机验收。macOS 包未配置开发者签名与公证。

## Pi Web 服务端部署与配置

Remote Pi 是桌面客户端，需要服务器先运行 Pi Coding Agent 和 Pi Web。客户端对应 Pi Web `1.202610.3`，本仓库附带其已适配提交 [`95f5a176647460dbba2847615a31f3d777249e6e`](https://github.com/jmfederico/pi-web/commit/95f5a176647460dbba2847615a31f3d777249e6e) 的完整原始源码，位于 [`vendor/pi-web/`](../../vendor/pi-web/)。来源、版本和更新方式见 [`vendor/README.md`](../../vendor/README.md)。该目录是随仓库提交的普通源码目录，克隆 Remote Pi 后即可获得，无需初始化 submodule；桌面 App 的安装包不包含这份服务端源码。

历史快照、状态目录和插件协议随上游演进。本项目以此提交作为兼容基线，不保证任意旧版或上游最新提交都兼容。随附源码保持上游原样，另附 [`yield_to_subsessions` 服务端补丁](../../vendor/patches/yield-to-subsessions.patch)：等待子 Agent 时保持父会话运行，收到结果后继续处理，避免提前显示完成红点或发送排队消息。另附[依赖安全补丁](../../vendor/patches/security-dependencies.patch)，修复服务端与测试依赖的已知告警。两项补丁均需在服务器部署；升级桌面客户端不会改变已运行的 Pi Web / Pi 运行时。

### 1. 准备服务器环境

推荐使用支持 systemd 用户服务的 Linux 服务器，以实际运行开发任务的普通用户安装。需要：

- Node.js ≥ 22.19.0、npm、Git，以及项目所需的开发工具；建议使用 Node.js 24。
- Pi Coding Agent **1.x** 的模型凭据；下方源码安装会安装匹配的 SDK，首次使用可在安装后完成登录。该版 Pi Web 不支持 Pi 0.x / 2.x。
- 构建源码及 `node-pty` 原生模块所需的 Python 3、C/C++ 编译器和 make。Debian / Ubuntu 可先安装 `git python3 build-essential`。
- 客户端能够通过 SSH 登录这个用户。桌面端沿用系统 OpenSSH 配置、密钥和 ssh-agent。

首次使用时，完成下一节源码安装后，在 `vendor/pi-web` 目录运行 `./node_modules/.bin/pi`，按所用模型提供商完成登录或 API Key 配置，确认能选择模型并正常使用后退出。凭据保存在服务器的 Pi 用户配置中，不写入 Remote Pi 源码或 Git 仓库。自定义模型与全局扩展也应在此用户下配置；默认 Pi 状态目录为 `~/.pi/agent`，使用 `PI_CODING_AGENT_DIR` 时必须让 sessiond 使用相同路径。

服务使用登录 Shell 的 `-lc` 环境启动。Node / npm、模型提供商环境变量与代理设置必须在该环境可见：Bash 通常读取 `~/.bash_profile` 或 `~/.profile`，Zsh 读取 `~/.zprofile`；仅写入交互式 `.bashrc` / `.zshrc` 可能不生效。若 `pi-web doctor` 提示缺少工具，先按其提示修复 PATH。

### 2. 安装随仓库固定的 Pi Web 源码（推荐）

将本仓库放到服务器的长期保留目录，在 **Remote Pi 仓库根目录**执行以下命令。桌面客户端与服务端分别安装依赖，不共用 `node_modules`。更新已有服务时，先等所有会话、子 Agent、终端和后台任务结束，再修改服务端源码及依赖。

```bash
git apply --check --directory=vendor/pi-web vendor/patches/yield-to-subsessions.patch
git apply --check --directory=vendor/pi-web vendor/patches/security-dependencies.patch
git apply --directory=vendor/pi-web vendor/patches/yield-to-subsessions.patch
git apply --directory=vendor/pi-web vendor/patches/security-dependencies.patch
cd vendor/pi-web
npm ci --allow-scripts=node-pty
npm run build
npm audit
npm link --ignore-scripts
pi-web --version
```

两项补丁各对上述固定源码基线应用一次；已应用时不要重复执行 `git apply`。yield 补丁让等待期间父会话保持蓝点，不产生本轮完成的未读标记；工具返回后继续整合结果，直到父会话实际完成才进入完成状态，取消操作仍可中断等待。安全补丁锁定 Undici `8.12.2`（同时覆盖 Pi SDK 的嵌套依赖）、fast-uri `3.1.9` / `4.2.3`，并将仅供测试的 happy-dom 升至 `21.0.4`。

`npm run build` 构建服务端、Web UI 和插件。`npm link --ignore-scripts` 将 `pi-web`、`pi-web-server`、`pi-web-sessiond` 命令链接到这份已构建源码，使用源码目录中经 `npm ci` 锁定的依赖；需让当前用户可写 npm 全局前缀并将其 `bin` 目录加入 PATH。服务运行期间必须保留源码目录、`dist` 和 `node_modules`，不能移动或清理它们。`--allow-scripts=node-pty` 按上游安装说明授权 npm 12 构建终端所需的原生模块；若当前 npm 不识别此选项，应使用支持它的 npm，或按该 npm 版本的生命周期脚本策略允许 `node-pty` 安装，并用 `pi-web doctor` 验证。

此处使用源码链接安装，是因为 npm 的 `overrides` 只对安装根项目生效。直接全局安装原版 `@jmfederico/pi-web@1.202610.3`，或对源码执行 `npm pack` 后全局安装 tarball，都可能重新安装 Pi SDK 固定的旧版 Undici，不能保留本补丁的依赖安全修复。原版发布包也不含 yield 补丁。不要用上述方式替代源码安装，也不要直接运行 `pi-web update` 覆盖修复。

安装到已有服务器后，还须在确认任务全部结束的情况下按下方说明重启两个用户服务，才能加载新代码与依赖。仅更新本机客户端、源码文件或全局命令链接不会更新正在运行的 sessiond。

### 3. 配置监听、子会话和插件

默认全局配置文件为 `~/.config/pi-web/config.json`（也可由 `PI_WEB_CONFIG` 或 `XDG_CONFIG_HOME` 指定）。首次安装可创建如下配置；已有配置时只合并所需字段，保留现有设置。

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

- `spawnSessions` 与 `subsessions` 启用跟踪子会话，Remote Pi 据服务端父子关系显示 Agent 树；`askUser` 启用 Agent 提问表单。
- 文件浏览来自核心接口；Git / Diff 需要随附的 `git` 插件。终端使用随附的 `pi-web.terminal` 插件及 paired channel v1；它是该版 Pi Web 正常启动所需的插件，无需另装终端插件。
- 其他插件通过服务器的 Pi Web 全局配置管理；Remote Pi 不提供打开原版 Pi Web 界面的入口。服务端插件、全局 Provider 或 sessiond 配置变更需要重启 sessiond；仅刷新网页不生效。
- 全局配置、Pi 凭据与 Pi Web 运行状态是不同文件：`~/.pi-web` 默认存放项目、机器等受管理状态，不应当作全局配置文件目录手工编辑。

保持 `127.0.0.1:8504` 监听，由客户端通过 SSH 转发；不要为连接 Remote Pi 而将 Pi Web 端口直接暴露到公网。Pi Web 以开发用户权限执行代码、终端及插件，只添加可信的项目和扩展。

### 4. 安装用户服务并检查健康

首次部署时，在服务器的独立 SSH 终端执行：

```bash
pi-web install --host 127.0.0.1 --port 8504
pi-web doctor
pi-web status
curl --fail http://127.0.0.1:8504/api/sessiond/health
```

使用自定义配置路径时，将安装命令改为 `pi-web install --config /absolute/path/config.json --host 127.0.0.1 --port 8504`，使 web/API 与 sessiond 共同使用该路径。安装命令会创建并启动用户服务；重新安装到已有服务器会替换服务，应先结束任务。

Linux 的两个生产服务为 `pi-web.service`（Web / API）与 `pi-web-sessiond.service`（会话运行时）。如需退出 SSH 或重启服务器后仍能启动用户服务，由有权限的用户执行：

```bash
sudo loginctl enable-linger "$USER"
systemctl --user is-active pi-web.service pi-web-sessiond.service
```

诊断失败时使用 `pi-web logs` 或 `journalctl --user -u pi-web.service -u pi-web-sessiond.service -n 100 --no-pager` 查看日志。PATH / 模型列表异常先检查服务登录环境；终端不可用时先检查 `node-pty` 与插件状态。

更新服务端或修改需要重启的配置时，先确认所有会话、子 Agent、终端和服务下的后台任务已结束，再从独立 SSH 终端执行：

```bash
systemctl --user restart pi-web.service
systemctl --user restart pi-web-sessiond.service
pi-web doctor
pi-web status
```

sessiond 重启会打断其持有的任务；关闭桌面窗口不会停止远端任务。需要长期保活的代理或其他进程应放到独立服务，避免随 Pi Web 一起被重启。

上游也支持 macOS LaunchAgents，但本客户端的「刷新远端环境」仅支持 Linux + Python ≥ 3.8 + 上述两个 systemd 用户服务。更多细节见随附的[安装指南](../../vendor/pi-web/docs/install.html)、[配置参考](../../vendor/pi-web/docs/config.md)、[插件说明](../../vendor/pi-web/docs/plugins.md)，以及 [Pi Web 官方网站](https://pi-web.dev/install)。

## 连接与数据

1. 在 App 中填写服务器 IP、域名或 SSH 别名。
2. 用户名、SSH 端口和私钥可留空，沿用系统配置。必要时调整远端 Pi Web 端口。
3. 点击「连接工作台」，完成指纹确认和身份认证，进入新工作台。
4. 选择已有对话继续，或添加远端项目并创建对话。

转发目标固定为服务器的 `127.0.0.1:<Pi Web 端口>`。当前支持直接部署的 Pi Web；额外 HTTP 认证的反向代理入口不在连接流程范围内。客户端不自动安装服务。「刷新远端环境」目前要求 Linux、Python ≥ 3.8 和 `pi-web.service` / `pi-web-sessiond.service` 两个 systemd 用户服务；读取当前用户登录 Shell 的 `-lic` 环境。代理写入两个服务各自的 `zz-remote-pi-environment.conf`，不会改动已有的 `proxy.conf`、Shell 配置或全局 systemd 环境；重复刷新会备份之前的 App 配置。新终端未导出代理时会清除服务的旧代理并使用直连。若代理客户端或长期后台任务由 Pi Web 启动并仍属于该服务的 systemd cgroup，应先迁移到独立服务；App 会拦截这种情况，避免重启连带关闭代理或后台任务。

配置保存在 Electron `userData/settings.json`，macOS 通常为 `~/Library/Application Support/Remote Pi/settings.json`，只含服务器元数据与主题。私钥不复制；主机指纹由系统 OpenSSH 存入 `known_hosts`。

对话记录与任务保存在服务器。断开连接、关闭客户端或关闭终端面板不会停止远端 Agent / 终端进程；远端服务或服务器重启仍可能中断任务。

## 实现结构

以下 `src/` 路径相对于 `apps/desktop/`；公共源码与服务端源码位于仓库根目录。

```text
src/main/main.ts                 窗口与受限 IPC，网页子窗口隔离
src/main/pi-client.ts            Pi Web HTTP、快照与实时事件、插件和终端适配
src/main/tunnel.ts               OpenSSH 生命周期、端口转发、环境刷新通道与探测
src/main/refresh-environment.py  远端代理读取、服务配置、重启检查及回滚
src/main/auth-broker.ts          仅本机可用、带鉴权的 SSH_ASKPASS 请求代理
src/main/askpass.cjs             SSH 认证响应辅助进程
src/main/profiles.ts             连接配置校验与原子保存
src/renderer/main.tsx            连接管理与认证弹窗
src/renderer/workspace/          项目侧栏、聊天、输入框、工具卡片、工作区面板
src/renderer/workspace/PromptInput.tsx  命令、Skills、文件和模型补全
src/renderer/workspace/CommandDialog.tsx  命令选择与会话历史树交互
../../packages/core/            共用类型、历史/实时事件转换、会话与输入逻辑
../../packages/ui/              共用界面组件与主题
../../vendor/pi-web/            固定提交的上游 Pi Web 完整源码（独立部署）
../../vendor/README.md          上游来源、版本与源码更新说明
```

所有远端 API 和 WebSocket 通过主进程访问 SSH 隧道，渲染器只调用白名单操作。渲染器使用 sandbox / context isolation，禁用 Node integration；Markdown 不执行 HTML、不自动加载外部图片。外链子窗口不暴露桌面 IPC。

本版重做项目和聊天的主要流程；尚未在新界面完整迁移 Pi Web 所有插件 UI、任意文件上传和文件编辑。当前客户端不提供这些操作。

窗口随屏幕可用空间调整，支持最小 520 × 480 的窗口。窄窗口启动时默认收起项目侧栏，点击展开后侧栏缩窄并保持常驻；文件、变更与终端面板在窄窗口中位于聊天区下方，保持两个区域同时可见和可操作。输入栏随宽度换行，长对话、代码、设置与超高弹窗均可滚动查看。

输入框支持 ↑ / ↓ 回溯当前会话的历史输入，并在返回最新位置时恢复未发送草稿。首次从当前已加载的用户消息读取历史，随后保留本次客户端运行中成功提交的原文（包括命令与 Skill 调用）；失败的发送不进入历史。补全菜单打开时上下键用于选择补全项，多行文本仅在首行 / 末行触发历史切换；修改翻出的文本会成为新的草稿，不会改动旧消息。

## 验证

在仓库根目录运行：

```bash
npm test                       # 公共逻辑及两端逻辑测试
npm run test:e2e                # 桌面端到端测试
```

单元与集成测试覆盖命令与 Skills 的接口路由、文件路径补全与作用域、状态目录、已读回执及完成序号竞态、事件合并、流式快照去重、切换会话的竞态、自动重连、代理二进制帧的消息/状态/终端解码、API 路由、SSH 配置校验和真实 OpenSSH 登录 / 转发 / 断线。远端环境脚本另覆盖新 Shell 读取、代理转义、运行任务拦截、进程环境核验和配置回滚。Electron 端到端测试覆盖命令 / Skills / 模板补全与执行、扩展交互、历史树导航和分叉、异步补全隔离、环境刷新及草稿恢复、项目与对话操作、独立草稿、蓝点 / 红点及查看清除、模型选择、流式聊天、文件 / Diff / 终端、主题与断开。

测试服务只在本机临时启动，返回明确的测试数据；测试配置和 known_hosts 使用临时目录。迁移前还通过已有 SSH 隧道对真实 Pi Web 做了项目列表、工作区、会话历史快照、模型 / 思考强度、文件和 Git 状态的只读联调；未发送真实模型请求或修改远端项目。

## 致谢与许可证

感谢 **[Pi Web](https://github.com/jmfederico/pi-web)** 的作者 **Federico Jaramillo Martinez** 及所有贡献者。Remote Pi 的远端项目、工作区、持久会话、子 Agent 跟踪、实时事件与插件 / 终端服务均建立在 Pi Web 提供的能力之上；桌面工作台通过其 HTTP / WebSocket 接口访问这些能力。也感谢 **[Pi Coding Agent](https://github.com/earendil-works/pi)** 的维护者与贡献者提供 Agent 运行时。

Remote Pi 自身采用 [MIT License](../../LICENSE)。随附的 Pi Web 源码版权归其原作者，保持其原始 [MIT LICENSE](../../vendor/pi-web/LICENSE)、版权声明、README 与文档，不以 Remote Pi 的版权声明替代。再次分发该源码或其构建产物时，应保留上游许可证及依赖所需的声明。

Remote Pi 是独立桌面客户端，与 Pi Web、Pi Coding Agent 及 OpenAI 无官方关联，也不代表这些项目的官方客户端或认可。
