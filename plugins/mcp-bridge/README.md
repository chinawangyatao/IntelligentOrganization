# 公共 MCP 桥

两个宿主共享的 stdio MCP 服务，经 REST 使用后端同一套鉴权、版本检查和幂等记账。不保存供应商 Key，不从请求参数接收成员身份，不代理模型请求。

0.2.0 支持 App 启动的任务绑定会话。App 将 24 小时任务凭证保存在仓库之外、权限为 0600 的私有 `profile.json`，用 `IO_BINDING_FILE` 指向它；完整成员凭证仍留在 App 钥匙串中。宿主用 `IO_HOST` 声明为 codex 或 deepseek-harness。远程地址需 HTTPS，stdout 只输出协议，诊断仅输出 stderr。

全局 Codex 插件通过 MCP 实际提供的 `_meta.threadId`，读取 App 数据目录下 `work-sessions/threads/codex/<threadId>.json`，再解析对应 profile。每次调用重新验证，不使用项目名称、工作目录、App 最后选中的项目或旧版 `sessionId` 猜测归属。不同线程各自绑定，派生线程需要新的授权；已激活的 Codex profile 即使显式配置，也必须验证实际 threadId。显式 `IO_BINDING_FILE` 优先，已存在的精确线程索引也优先于旧环境令牌，校验失败不会扩大权限。

命令行兼容 `IO_SERVICE_URL`、`IO_MEMBER_TOKEN`。缺少凭证不会让 MCP 初始化退出，`organization_connection_status` 会给出从 App 授权的操作说明，数据工具返回 `connection_required`。不要把成员凭证或管理员引导凭证写入提示词、manifest 或仓库。

工具包含身份、项目、任务上下文和版本同步、成果提交、共享记忆草稿/版本（正式发布在 App 完成）、问题、交接接收、可见通信列表/消息读取/显式消息发送/提炼草稿，以及真实用量上报。发消息是写操作且有授权说明，不能自动转发私人会话。服务器的 401/403/409 作为 MCP tool error 可见返回。

绑定工具 `organization_bound_task_context`、`organization_bound_sync`、`organization_bound_submit`、`organization_bound_issue` 和 `organization_bound_usage` 使用当前会话的项目/任务/节点；显式传入其他编号会被拒绝。`organization_binding_status` 可检查授权状态。后端仍逐次校验到期、撤销、成员状态及任务执行权限，绑定令牌不能执行管理员操作、正式发布或人工验收。

`organization_bound_context` 为可信宿主钩子提供 `hookSpecificOutput.additionalContext`；也可通过 CLI `--hook SessionStart|UserPromptSubmit|PostCompact` 读取 stdin 中实际线程标识。它只读最新任务及正式记忆，不自动同步基线或提交成果。普通未绑定聊天返回 `{}`；已知绑定撤销、过期、丢失、错配或服务不可用时，返回停止项目写入的明确提醒。Codex 钩子需按宿主正常流程信任，工具和后端鉴权才是权限边界。

`pnpm --filter @intelligent-organization/mcp-bridge build` 后可启动 `node plugins/mcp-bridge/dist/cli.js`。`pnpm --filter @intelligent-organization/mcp-bridge test` 使用真实 stdio MCP client 与受控 REST stub 验证协议往返；真实服务联调可运行 `IO_SERVICE_URL=… IO_MEMBER_TOKEN=… node plugins/mcp-bridge/test/live-smoke.mjs`。
