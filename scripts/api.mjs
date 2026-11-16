import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv, root } from './env.mjs';
loadEnv();
const child = spawn('go', ['run', './cmd/server'], {
  cwd: resolve(root, 'services/server'),
  env: process.env,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {}
  });
child.on('exit', (code) => process.exit(code ?? 1));
