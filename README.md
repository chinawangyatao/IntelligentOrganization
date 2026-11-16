# 智能组织 · Intelligent Organization

面向人与 AI 共同交付项目的桌面协作工作台。成员继续使用自己的 Codex 或 DeepSeek Harness 和模型 API；共同服务保存项目事实、责任、成果版本、通信及可获取的用量。

当前为内部试点版本。客户端是 **Tauri 2 + React + TypeScript + shadcn/ui** 桌面 App；协同后端为 **Go + PostgreSQL**。Vite 仅用于开发桌面界面，不作为面向用户的网页产品。

## 本机启动

依赖 Node.js 22.19+（推荐 24）、pnpm 11、Go 1.24+、Rust 1.90+（本机使用 1.97 验证）、Tauri 系统构建依赖和 Docker。macOS 构建需要 Xcode Command Line Tools；当前桌面版最低 macOS 13.3，以匹配 Tailwind 4 所需的 WebView CSS 能力。

```sh
pnpm install
pnpm run setup:local
pnpm dev
```

`setup:local` 创建随机本地凭证及本项目专用 PostgreSQL 容器 `intelligent-organization-postgres`，绑定 `127.0.0.1:15439`；不复用其他项目的数据。默认使用本机已有的 PostgreSQL 16 镜像；可在 `.env` 中修改镜像或端口。

首次在 App 填写服务地址 `http://127.0.0.1:17890`，成员令牌使用本机 `.env` 中的 `IO_ADMIN_TOKEN`。令牌不会输出到启动日志。桌面端将令牌存入系统凭证库，配置文件仅保存服务地址。浏览器开发验证仅在 sessionStorage 暂存连接。

后端启动并连接后，可在另一个终端执行 `pnpm seed` 创建演示项目；不创建虚假的模型消耗。管理员新建成员时，访问令牌仅在创建响应中显示一次，需交给对应成员。试点使用令牌登录，尚无 SSO、邮件邀请或找回流程。

## 当前工作流

- 管理员默认进入组织总览，跨项目查看进度、负责人、阻塞与用量，再进入具体项目处理。普通成员按项目权限协作。
- 项目选择支持搜索，业务下拉统一使用 shadcn Select。侧栏底部系统设置支持浅色/深色/跟随系统及主题主色，本机保存外观偏好。
- 项目默认包含售前、产品经理、UI/UE、前后端开发、部署、测试与交付节点；节点多人，工作项明确主责及验收人。
- 共享记忆区分草稿和已发布依据，保留版本与来源。任务同步当前依据，提交及验收检查相关版本，旧依据需要重新核对。
- 问题有指派、接单和解决状态；交接包由真实项目记录生成，责任变更不改写历史作者或已完成任务。
- 从已有项目创建新项目时选择记忆，复制为带来源的草稿；任务重置为待办并清空人员、成果及费用。
- 项目/节点/任务/问题讨论与私聊、小群；消息持久化、未读、已读及提炼为草稿。项目管理员不能读取自己未参与的私聊。
- 任务分配、提交验收、退回、问题指派、责任移交和正式记忆变更触发定向通知；已读与接单分开。
- 用量按成员、任务、宿主、供应商和模型归集，按请求标识去重。金额按币种及实际上报/估算分开；没有预算拦截。

正式需求发布、成果验收和业务决策由负责人确认。AI 生成的建议或聊天摘要不自动成为事实。记忆一致性由版本记录及提交检查保证，不能保证模型绝不误解。

## 插件

- [Codex 插件](plugins/codex/README.md)：可携带协作技能及自包含 MCP 运行时。
- [DeepSeek Harness 插件](plugins/deepseek-harness/README.md)：按 Cordis 插件结构接入共享服务。
- [MCP bridge](plugins/mcp-bridge/README.md)：stdio 工具，通过 REST 使用同一套权限和业务规则。

安装说明以各目录 README 为准。不会自动修改你的 Codex/DSH 配置，不上传成员的模型 API Key。宿主适配器仅对显式绑定的项目工作提供协作能力，MCP 接入本身不代表能够读取所有会话、控制所有现有桌面会话或自动获取所有供应商余额。

## 检查与构建

```sh
pnpm check
pnpm build
pnpm test:api
pnpm test:flow
pnpm build:app
```

`test:api` 在专用数据库中创建随机测试 schema，结束后仅删除该 schema。`test:flow` 会启动临时服务并使用独立测试 schema，完成跨成员流程后清理该 schema；不会向正在试用的项目中添加测试成员或项目。

`build:app` 产物位于 `apps/desktop/src-tauri/target/release/bundle/macos/`。macOS 本机构建默认未签名、未公证；跨机器分发需要配置签名及发布流程。当前未提供自动更新服务。

## 文档与边界

- [架构与部署](docs/architecture.md)
- [API 与一致性规则](docs/api-contract.md)
- [验证记录](docs/verification.md)

首版暂不包含钉钉、供应商账号自动开户/充值、通用余额查询、平台远程托管所有 AI 执行、附件与音视频、端到端加密、离线写入合并。用户选择不同模型的能力取决于宿主及供应商接口兼容性。本地开发服务默认仅监听回环地址；公司多机使用应部署共享 Go 服务和 PostgreSQL，通过 HTTPS 入口连接，并配置备份及凭证管理。

## 参考

桌面技术组织参考 [cc-switch](https://github.com/farion1231/cc-switch)；DSH 扩展方式参考 [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 与宿主官方文档。业务代码独立实现，没有直接复制这两个项目的源码。
