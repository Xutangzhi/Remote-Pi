# 随附的 Pi Web 源码

`pi-web/` 保存 Remote Pi 当前适配的 Pi Web 上游源码，供审阅、构建及独立部署。它不参与桌面客户端构建，也不会被打入桌面安装包。

| 项目 | 固定值 |
| --- | --- |
| 上游 | <https://github.com/jmfederico/pi-web> |
| npm 包 | `@jmfederico/pi-web` |
| 源码中的版本号 | `1.202610.3` |
| Git 提交 | `95f5a176647460dbba2847615a31f3d777249e6e` |
| 原作者 | Federico Jaramillo Martinez 及上游贡献者 |
| 许可证 | [MIT](pi-web/LICENSE) |
| 本地源码改动 | 无；保留该提交的所有 Git 跟踪文件 |

源码通过克隆上游并导出上述提交引入。这里使用普通目录，而非嵌套 Git 仓库或 submodule，使公开仓库和源码压缩包都直接包含服务端源码。上游 `.git` 历史、依赖目录、运行配置和构建产物未复制。

## 安装与配置

参见主 [README 的部署说明](../README.md#configuration)。随附的上游说明为 [README](pi-web/README.md)、[安装指南](pi-web/docs/install.html)、[配置参考](pi-web/docs/config.md) 和[插件文档](pi-web/docs/plugins.md)。`pi-web/` 保留原始上游版本；Remote Pi 的独立补丁位于 `patches/`，按[桌面 README 的服务端部署步骤](../apps/desktop/README.md#2-安装随仓库固定的-pi-web-源码推荐)在构建前同时应用，不改写上游来源信息。

[`yield-to-subsessions.patch`](patches/yield-to-subsessions.patch) 将 `yield_to_subsessions` 的提前结束改为可取消的异步等待：父会话等待子 Agent 和整合结果期间保持运行状态，避免提前发布完成未读标记、变成红点或消耗排队消息。随补丁附带工具、服务与真实 Pi SDK 的回归测试，验证等待、结果返回、最终完成及取消路径。它只针对上表的完整提交，不用于直接覆盖任意 npm 发布包的编译产物。已运行的 sessiond 需要在所有任务与终端结束后重启才能加载。

[`security-dependencies.patch`](patches/security-dependencies.patch) 更新独立服务端的依赖及锁文件：Undici `8.12.2` 覆盖直接依赖和 Pi SDK 固定的旧版依赖，fast-uri 分别固定到 `3.1.9` / `4.2.3`，仅用于测试的 happy-dom 升至 `21.0.4`，并调整三个 iframe 测试夹具以适配新的安全默认值，保持原有断言。补丁不属于上游原始提交，原始 `pi-web/` 目录仍逐文件保留。依赖审计结果只适用于应用补丁并按锁文件安装后的依赖树；原始快照本身仍包含旧依赖声明。

部署采用 `npm ci`、`npm run build`、`npm link --ignore-scripts`，保留安装根项目的依赖 overrides。不要替换为原版 npm 全局安装或 tarball 全局安装：这些方式会重新解析 Pi SDK 的 peer 依赖，可能再次安装旧版 Undici。链接安装依赖源码目录，服务运行期间需保留该目录及其构建产物。更新已有服务须先确认全部任务结束，再安装并重启两个用户服务；客户端升级不会自动部署这些补丁。

## 复现与更新

可在独立临时目录复现此基线：

```bash
git clone https://github.com/jmfederico/pi-web.git pi-web-upstream
git -C pi-web-upstream checkout --detach 95f5a176647460dbba2847615a31f3d777249e6e
git -C pi-web-upstream rev-parse HEAD
```

引入新的上游版本时，先在独立目录核对其 API 与插件协议并验证 Remote Pi，再用新提交的完整源码替换 `pi-web/`；保留上游许可证，同步更新本文件及主 README 的版本、完整提交号和部署命令。不要仅按版本号推断源码相同，也不要将本机或服务器的依赖、凭据、会话数据复制进来。
