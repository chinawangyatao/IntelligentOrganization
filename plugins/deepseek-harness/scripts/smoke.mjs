import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../mcp-bridge/test/bridge.test.mjs', import.meta.url))], {
  stdio: 'inherit', env: { ...process.env, IO_MCP_TEST_CLI: fileURLToPath(new URL('../runtime/server.cjs', import.meta.url)) },
});
process.exitCode = result.status ?? 1;
