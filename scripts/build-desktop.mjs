import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['@intelligent-organization/codex-plugin', '@io/desktop']) {
  const command = name === '@io/desktop' && process.argv.includes('--dev') ? 'dev' : 'build';
  const result = spawnSync('pnpm', ['--filter', name, command], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
