import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv, root } from './env.mjs';
loadEnv();
const result = spawnSync('go', ['test', '-race', './...', '-count=1'], {
  cwd: resolve(root, 'services/server'),
  env: { ...process.env, IO_TEST_DATABASE_URL: process.env.IO_DATABASE_URL },
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
