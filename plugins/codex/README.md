# Codex 接入插件

插件 `0.2.1` 包含 portable 清单、`.codex-plugin` 兼容布局、自包含 Node MCP runtime、App 会话 launcher 和全局 `hooks/hooks.json`。Node 22+ 必须可用。运行 `pnpm --filter @intelligent-organization/codex-plugin build` 构建，`test` 校验清单、启动协议和 MCP 行为。复制整个插件包即可，不依赖仓库目录。

## 从 App 启动固定任务

用户在 App 选择任务、Codex 和绝对工作目录。App 创建工作会话，将受限短期凭证保存到仓库外的私有 `0600` profile。平台完整成员凭证保留在 App Keychain。

App 启动 `[nodeExecutable, absolutePluginPath/runtime/launcher.cjs]`，通过 stdin 发送一份 JSON，然后关闭 stdin：

```json
{"profilePath":"/absolute/private/profile.json","workspacePath":"/absolute/workspace","codexPath":"/absolute/path/to/codex"}
```

`codexPath` 可省略，默认使用 PATH 中的 `codex`。profile 格式为 `{version:1,baseUrl,token,session,workspacePath}`，`session` 使用服务端返回的完整 `WorkSession`。launcher 只读取 profile，不更新、不输出其中的 token。

成功时 stdout 只有一行 JSON：

```json
{"nativeSessionId":"real-codex-thread-id","deepLink":"codex://threads/real-codex-thread-id","warnings":["首次请在 Codex 审核并信任 Hooks"]}
```

App 随后使用完整成员凭证调用 attach，将服务返回的激活会话写回 profile，保存精确的线程索引，再打开深链。launcher 不打开 URL、不发送用户 prompt、不调用 `turn/start`。App 对服务端已 active 且有 nativeSessionId 的会话，直接执行幂等 attach → 本机 activate → 打开深链，恢复不依赖 Node、Codex CLI 或原工作目录。launcher 仅用于尚未获得真实线程编号的新会话。已有 `session.nativeSessionId` 时仅返回相同深链，先向服务校验绑定，不读取 Codex 历史或创建新线程。

失败时 exit code 为 `1`，stdout 为 `{error,code}`。错误和子进程日志不会带出授权值。App 必须将启动或 attach 失败显示为错误，不能假称 active。

## 宿主协议和兼容性

launcher 按本机 Codex CLI `0.156.1` 生成的 App Server schema 实现 `initialize` → `initialized` → `thread/start`，使用独立 `codex app-server --stdio`。检查任务 MCP 工具后，用 `thread/inject_items` 持久化真实 developer 上下文、设置线程名，再关闭进程以释放写锁。它不会安装或启动系统 daemon，不接管其他现有桌面聊天，不创建用户 turn。实测该线程可由另一独立 App Server 恢复，turn 数量为零；原生桌面深链打开仍需用户实机确认。

线程保留成员本机配置的 provider、model、sandbox 和 approval 设置，不传危险权限覆盖。启动阶段增加 `intelligent-organization-task` 的 required MCP server，配置 Node runtime、`IO_BINDING_FILE` 私有文件路径和 `IO_HOST=codex`，以验证运行组件可用。实测每线程 MCP config 不随 rollout 跨进程恢复，因此不能只依靠启动时的线程配置保证自动刷新。桌面后续依靠已安装的全局插件和 App 写入的精确线程索引。项目、任务与身份来自服务端授权绑定，禁止依据工作目录或相似项目名称猜测。

## 自动读取共同记忆

全局插件的 `SessionStart`、`UserPromptSubmit`、`PostCompact` hooks 调用其 `intelligent-organization` MCP server 的只读 `organization_bound_context`。工具按宿主传入的真实 `threadId` 查精确索引，不调用任务同步或验收。未绑定聊天中的 hook 安静返回空上下文；不会读取 App 当前项目。已绑定时返回 JSON 文本块中的 `hookSpecificOutput.additionalContext`。安装启用插件并信任 hooks 后，每轮无需重复 `@` 技能。launcher 不再添加每线程 hooks，避免重复。

首次使用或 hooks 更新后，用户需在 Codex **设置 → Hooks**（CLI 为 `/hooks`）审核并信任。插件不写入 trust hash，不绕过宿主审核。MCP hook 只调用已经连接的 server；`SessionStart` 可能早于 MCP 就绪，hook 失败可能不阻止继续。因此服务端始终重新检查授权、真实线程匹配、权限和记忆版本。工具不可用时应从 App 重新连接，不能把失败的 hook 当成已同步。

普通全局插件不再因缺少环境变量而退出，连接状态工具提示从 App 启动。CLI/CI 仍可显式配置 `IO_SERVICE_URL` 和 `IO_MEMBER_TOKEN`；远程地址必须使用 HTTPS，不要把 token 写入可分发清单或聊天。

私人聊天不会自动成为共同记忆；发送成员消息仍需用户明确要求。AI 只能提出记忆草稿，负责人在 App 正式发布。当前不声称自动采集所有 Codex 用量或供应商余额。

参考：[App Server](https://learn.chatgpt.com/docs/app-server)、[Hooks](https://learn.chatgpt.com/docs/hooks)、[插件结构](https://developers.openai.com/plugins/build/plugins)。
