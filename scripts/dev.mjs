import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv, root } from './env.mjs';
import { startDatabase } from './database.mjs';
const { baseUrl, token } = loadEnv({ create: true });
await startDatabase();
const children = [];
let stopping = false;
function kill(child, signal = 'SIGTERM') {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {}
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) kill(child);
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('exit', (code) => stop(code ?? 1));
  return child;
}
let reuse = false;
try {
  const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
  if (health.ok) {
    const me = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!me.ok)
      throw new Error('此端口已有服务，但当前配置无法认证。请确认 .env 与正在运行的服务一致。');
    reuse = true;
  }
} catch (e) {
  if (e.message?.includes('已有服务')) throw e;
}
if (!reuse) launch('go', ['run', './cmd/server'], resolve(root, 'services/server'));
else console.log('复用已经运行的本项目服务。');
let healthy = false;
for (let i = 0; i < 120; i++) {
  if (stopping) break;
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!healthy) {
  stop(1);
  throw new Error('后端未就绪，请检查服务日志。');
}
launch('pnpm', ['--filter', '@io/desktop', 'tauri', 'dev'], root);
