# Codex 接入插件

已提供新的 portable `plugin.json` / `mcp.json`，以及受支持的 `.codex-plugin/plugin.json` / `.mcp.json` 兼容布局。`pnpm -r --filter "./plugins/**" build` 生成自包含 Node stdio runtime，插件复制到安装缓存后不依赖仓库相对目录。

在 Codex 启动环境中设置 `IO_SERVICE_URL`（默认 http://127.0.0.1:17890）和 `IO_MEMBER_TOKEN`（成员平台令牌）。Node 22+ 必须可见于宿主 PATH。远程服务要求 HTTPS。令牌不是供应商模型 Key，不应写入 manifest、技能或聊天。

可按当前 Codex 官方本地插件文档通过 local marketplace 安装本目录；插件使用 `${PLUGIN_ROOT}` 定位打包 runtime。此仓库不写入用户现有 Codex 设置，不自动安装。若所用旧发行版的 MCP 子进程未继承环境，需要使用该版本支持的本地环境传递设置；不要把 token 写进可分发文件。

安装后启用 project-collaboration 技能，先读取任务上下文，再显式同步版本并提交成果。默认不配置 hooks：MCP 不会自动获得所有会话、完整交流记录或用量。usage 工具只接收可核实的请求数据；Codex 自动用量采集和主动启动/暂停其他会话留待受管理执行接入验证。

通信工具将读取和写入区分；发送消息要求用户明确请求，技能不会自动转发私人会话。AI 工具只新增或修改草稿，正式发布记忆在 App 由负责人完成。

参考：[官方插件结构](https://developers.openai.com/plugins/build/plugins)、[官方插件 MCP 配置测试](https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/plugin_config_tests.rs)。
