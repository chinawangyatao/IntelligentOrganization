import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, root } from './env.mjs';

const { db } = loadEnv();
if (!['127.0.0.1', 'localhost'].includes(db.hostname)) {
  throw new Error(
    '完整流程测试使用本机专用 Docker 数据库；远程环境请使用 test:api 的独立 schema 测试。',
  );
}
const container = 'intelligent-organization-postgres';
const inspect = spawnSync(
  'docker',
  ['inspect', '--format', '{{json .HostConfig.PortBindings}}', container],
  { encoding: 'utf8' },
);
const bindings = inspect.status === 0 ? JSON.parse(inspect.stdout)?.['5432/tcp'] : [];
if (!bindings?.some((binding) => binding.HostPort === db.port && binding.HostIp === '127.0.0.1')) {
  throw new Error('测试数据库配置未匹配本项目专用容器，请先执行 pnpm run setup:local。');
}
const schema = `io_flow_${randomBytes(8).toString('hex')}`;
function sql(statement) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '--env',
      'PGPASSWORD',
      '-i',
      container,
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      decodeURIComponent(db.username),
      '-d',
      db.pathname.slice(1),
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: statement,
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: decodeURIComponent(db.password) },
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || '独立测试 schema 操作失败');
}
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
const testDb = new URL(db);
testDb.searchParams.set('search_path', schema);
const testEnv = {
  ...process.env,
  IO_ISOLATED_FLOW: '1',
  IO_ADDR: `127.0.0.1:${port}`,
  IO_DATABASE_URL: testDb.toString(),
  IO_ADMIN_TOKEN: randomBytes(32).toString('base64url'),
};
const binary = resolve(root, 'work/bin/io-flow-server');
mkdirSync(resolve(root, 'work/bin'), { recursive: true });
const build = spawnSync('go', ['build', '-o', binary, './cmd/server'], {
  cwd: resolve(root, 'services/server'),
  stdio: 'inherit',
});
if (build.status !== 0) throw new Error('测试服务构建失败');
let server;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
}
sql(`CREATE SCHEMA "${schema}";`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    cleanup()
      .then(() => process.exit(130))
      .catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
  });
try {
  server = spawn(binary, [], { cwd: root, env: testEnv, stdio: 'inherit' });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('独立测试服务提前退出');
    try {
      const response = await fetch(`http://${testEnv.IO_ADDR}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('独立测试服务启动超时');
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/verify-flow.mjs')], {
    cwd: root,
    env: testEnv,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('跨成员流程验证失败');
  console.log('完整流程测试通过；所有测试项目、成员及通信均在独立 schema 中，试用项目不受影响。');
} finally {
  await cleanup();
}
