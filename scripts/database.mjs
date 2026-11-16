import { spawnSync } from 'node:child_process';
import { loadEnv } from './env.mjs';
export async function startDatabase() {
  const { db } = loadEnv({ create: true });
  if (!['127.0.0.1', 'localhost'].includes(db.hostname))
    throw new Error('db:up 仅创建本机开发数据库；远程数据库请自行管理。');
  const name = 'intelligent-organization-postgres';
  const inspect = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], {
    encoding: 'utf8',
  });
  if (inspect.status !== 0) {
    const args = [
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'com.weimeng.project=intelligent-organization',
      '-p',
      `127.0.0.1:${db.port}:5432`,
      '-v',
      'intelligent-organization-postgres:/var/lib/postgresql/data',
      '-e',
      `POSTGRES_USER=${decodeURIComponent(db.username)}`,
      '-e',
      `POSTGRES_PASSWORD=${decodeURIComponent(db.password)}`,
      '-e',
      `POSTGRES_DB=${db.pathname.slice(1)}`,
      process.env.IO_POSTGRES_IMAGE || 'postgres:16-alpine',
    ];
    const result = spawnSync('docker', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || '创建开发数据库失败');
  } else if (inspect.stdout.trim() !== 'true') {
    const result = spawnSync('docker', ['start', name], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || '启动开发数据库失败');
  }
  const ports = spawnSync(
    'docker',
    ['inspect', '--format', '{{json .HostConfig.PortBindings}}', name],
    { encoding: 'utf8' },
  );
  const bindings = ports.status === 0 ? JSON.parse(ports.stdout)?.['5432/tcp'] : null;
  if (!bindings?.some((binding) => binding.HostPort === db.port && binding.HostIp === '127.0.0.1'))
    throw new Error(
      '现有项目数据库容器端口与 .env 不一致。请恢复连接配置，或手动迁移容器端口；本脚本不会删除现有数据。',
    );
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync(
      'docker',
      [
        'exec',
        name,
        'pg_isready',
        '-U',
        decodeURIComponent(db.username),
        '-d',
        db.pathname.slice(1),
      ],
      { encoding: 'utf8', timeout: 2000 },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('PostgreSQL 初始化超时，请查看本项目数据库容器日志。');
  const auth = spawnSync(
    'docker',
    [
      'exec',
      '--env',
      'PGPASSWORD',
      name,
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      decodeURIComponent(db.username),
      '-d',
      db.pathname.slice(1),
      '-tAc',
      'SELECT 1',
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PGPASSWORD: decodeURIComponent(db.password) },
    },
  );
  if (auth.status !== 0)
    throw new Error(
      '项目数据库已启动，但 .env 中的数据库用户、库名或密码无法认证。请核对原有配置；本脚本不会重置账户或数据。',
    );
  console.log(`专用数据库容器 ${name} 已就绪；凭证仅保存在 .env。`);
}
if (process.argv[1]?.endsWith('database.mjs')) await startDatabase();
