# 宿主会话交接验证

验证只启动运行时、创建协同测试线程和调用只读上下文工具，不发送模型请求，不读取其他聊天、用户供应商凭证或全局配置。

## Codex CLI 0.156.1

本机 CLI 的 schema 位于 `work/codex-schema`。评估中确认 `app-server proxy` 直接转发 Unix control socket 字节，该 socket 使用 WebSocket HTTP Upgrade，不能把 proxy 当成 JSONL。共享 daemon 还会保持线程的 active writer，阻止其他独立宿主同时恢复。因此最终 launcher 使用独立 `app-server --stdio`，完成后关闭以释放写锁，不启动 daemon。

只调用 `thread/start` 返回的空线程可能尚未落盘，断开后不能恢复。launcher 会检查任务专用 MCP 工具已加载，再用 `thread/inject_items` 持久化真实 developer 项目上下文并设置线程名。这个操作不创建用户 turn，不触发模型。App 必须在 launcher 成功后才 attach，随后保存精确线程索引并打开深链。

实测独立进程可以恢复上述持久线程、turn 数为零，但每线程 `mcp_servers` config 不随 rollout 恢复。同一 daemon 里的第二连接仍看到配置只代表内存保留，不能证明自动刷新可跨宿主保留。最终方案在启动时用 required MCP 检查运行组件，桌面恢复后使用已安装的全局插件与精确线程索引。全局 hook 对未绑定聊天返回空上下文，绑定失效时不能继续业务写入；不注入重复的每线程 hooks。首次安装/更新仍需用户审核并信任 hooks，未静默写入信任设置。原生桌面深链导航和首次 hook 信任需用户实机确认，不能声称已通过 UI 验收。

## DeepSeek Harness Desktop 0.2.2-rc.2

已检查本机 `/Applications/DeepSeek Harness.app` 的安装包代码，build commit 为 `a6b1b85f44891ee1484bed6a9fc08acaae777d90`。bundled CLI 在 `Contents/Resources/runtime/cli/bin/dsh`，不要求系统 PATH 中另装 dsh。

当前稳定交接边界如下：

- Electron `open-url` 只识别 `dsh://open` 和 `dsh://open/` 来聚焦窗口，没有定位指定会话的深链。
- SDK stdio JSON-RPC 提供 `initialize`、`session/prompt`、`session/query`、`session/resume`、`session/wait`、工作目录操作和 `shutdown`，没有公开 `session/create`。
- Host 内部 `apiSessions.create({cwd})` 可以不调用模型创建会话，但经已授权的 typed gateway 使用。桌面 Host 将随机授权连接信息通过父子进程 IPC 交给 Electron；当前未发现供第三方 App 使用的公开控制 socket、发现和授权交接协议。

因此，当前发行版不能用已有公开接口完成“协同 App 创建空会话 → 取得真实会话 ID → 打开原生桌面并定位该会话”的闭环。仅启动应用、生成本地随机 ID，或把 `dsh://open` 作为会话深链，都不能标记为已连接。

App 中 DSH 启动应明确提示 `host_handoff_unsupported` 并保持 prepared/error。现有 DSH MCP/用量插件保留；后续需要新增并验证 Host launch bridge，提供用户授权、精确会话创建/绑定以及桌面导航能力。不要读取或复制桌面内部 auth cookie 来绕过该边界。
