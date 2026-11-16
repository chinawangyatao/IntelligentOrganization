# DeepSeek Harness 接入插件

使用与 dsh-agent-teams 相同的 `src/index.ts`、`Config` / `apply`、`cordis.patch.yml` bundle 组织方式。此插件为当前 Host 注册一个具备生命周期的 MCP stdio server；卸载时由 MCP manager 清理工具。它不会创建 AI 成员或接管未授权会话。

## 本地接入

先从仓库根目录 `pnpm install`、`pnpm -r --filter "./plugins/**" build`。DSH profile 必须提供 `mcpManager`。0.2.0 缺少凭证时仍注册 MCP，连接状态工具会提示从 App 授权，不再因 `IO_MEMBER_TOKEN is required` 直接退出。

App 绑定接线使用 `bindingFile`（或 `IO_BINDING_FILE`）指向仓库外的私有 0600 profile。MCP 注册项只传文件路径，不包含原始任务凭证。一次绑定固定到项目、任务、节点及实际原生会话，已撤销、过期、未激活或错配的授权不能开展项目操作。

当前验证的 DSH 0.2.2-rc.2 没有第三方可用的原生会话创建/交接接口，因此 App 不能宣称已完成一键启动和自动上下文注入。准备的授权保持 prepared；不会用进程号或伪造会话 ID 激活。后续接入真实宿主接口后才能开放该流程，具体证据见 [宿主兼容性](../../docs/host-compatibility.md)。

兼容原来的手动接入，启动 DSH 前设置：

- `IO_MEMBER_TOKEN`：本成员的平台访问令牌，不是模型供应商 API Key。
- 插件 `baseUrl`：协同服务地址，本机默认为 `http://127.0.0.1:17890`。远程须 HTTPS。

旧环境凭证接入依赖 DSH 的 `credentials` 模板服务；profile 方式不依赖它。模型供应商 API Key 仍由成员自己的模型配置管理。

按所用 DSH 版本的 `dsh plugin --profile <profile> add <本包绝对路径>` 安装本地包。此仓库不会替你修改现有 profile。构建会生成自包含 Host 插件入口及 MCP runtime；`pnpm --filter @intelligent-organization/dsh-plugin pack --pack-destination <目录>` 可制作本地 tarball，再交给 DSH 安装。模型服务桥只作为构建依赖，运行时不需要另行发布 bridge 包。

## 共享上下文

模型可以通过 MCP 的 task_context 查看任务依据，显式 task_sync 捕获新版本，提交成果时服务端再次检查版本。绑定完成的会话也可使用 organization_bound_task_context 等工具，服务端验证实际授权范围。MCP 连接本身不强制注入所有正在运行会话，不读取私人会话。聊天发送工具只在用户明确要求或明确调用的项目技能授权时调用。

## 可选的自动用量采集

私有 profile 模式只观察 active 且实际 durable session ID 与授权完全一致的会话；prepared 或其他会话不会采集。手动接入模式默认关闭，管理员只给**明确归属于项目的会话**设置 `telemetryBindings`：

```yaml
telemetryBindings:
  - sessionId: exact-dsh-session-id
    projectId: project-id
    nodeId: node-id
    taskId: task-id
```

仅观察 allowlist 会话的 durable `assistant/message` / `assistant/attempt`；从 `usage` 或 compact stream 最后一个 usage chunk 读取真实计数，从 session.requestContext() 读取模型路由。DSH 的输入/缓存是分离桶，转换成服务端的含缓存输入计数；不重复累加 reasoning。持久会话 ID + event seq 生成去重键；失败/重试若有独立已记录的请求用量，各按实际 attempt 计入。usage-only outbox 断网保留，无凭证或会话正文，恢复后通过后端幂等 API 补报。

profile 模式的 outbox 存在 profile 所属私有目录内，按服务、凭证和绑定隔离；上传携带实际原生会话标识供后端校验。未知用量、缺失路由、硬进程丢失前未落日志的请求不能恢复，金额保持 unknown，不能伪称账单。宿主升级改变事件格式时可能跳过采集，需要重新兼容验证。fixture 和桥接测试不等于已在所有 DSH 发行版实机验收。自动上下文推送、自动抓取完整会话、模型账户自动开通均未实现。

参考：[官方 MCP manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-manager/README.md)、[官方 session 事件](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/src/types.ts)、[参考 bundle](https://github.com/NanmiCoder/dsh-agent-teams)。
