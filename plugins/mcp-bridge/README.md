# 公共 MCP 桥

两个宿主共享的 stdio MCP 服务，经 REST 使用后端同一套鉴权、版本检查和幂等记账。不保存供应商 Key，不从请求参数接收成员身份，不代理模型请求。

配置：`IO_SERVICE_URL`、`IO_MEMBER_TOKEN`、`IO_HOST`（宿主设置为 codex 或 deepseek-harness）。远程地址需 HTTPS。所有 stdout 均为协议输出，诊断仅 stderr。

工具包含身份、项目、任务上下文和版本同步、成果提交、共享记忆草稿/版本（正式发布在 App 完成）、问题、交接接收、可见通信列表/消息读取/显式消息发送/提炼草稿，以及真实用量上报。发消息是写操作且有授权说明，不能自动转发私人会话。服务器的 401/403/409 作为 MCP tool error 可见返回。

`pnpm --filter @intelligent-organization/mcp-bridge build` 后可启动 `node plugins/mcp-bridge/dist/cli.js`。`pnpm --filter @intelligent-organization/mcp-bridge test` 使用真实 stdio MCP client 与受控 REST stub 验证协议往返；真实服务联调可运行 `IO_SERVICE_URL=… IO_MEMBER_TOKEN=… node plugins/mcp-bridge/test/live-smoke.mjs`。
