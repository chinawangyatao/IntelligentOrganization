import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
export function loadEnv({ create = false } = {}) {
  const file = resolve(root, '.env');
  if (!existsSync(file) && create) {
    const password = randomBytes(18).toString('hex');
    writeFileSync(
      file,
      `IO_ADDR=127.0.0.1:17890\nIO_DATABASE_URL=postgres://io_app:${password}@127.0.0.1:15439/intelligent_organization?sslmode=disable\nIO_ADMIN_TOKEN=${randomBytes(32).toString('base64url')}\nIO_POSTGRES_IMAGE=docker.m.daocloud.io/library/postgres:16-alpine\nIO_POSTGRES_PORT=15439\n`,
      { mode: 0o600 },
    );
  }
  if (!existsSync(file)) throw new Error('请先执行 pnpm run setup:local 生成本地 .env。');
  process.loadEnvFile(file);
  const db = new URL(process.env.IO_DATABASE_URL);
  if (!process.env.IO_ADMIN_TOKEN || process.env.IO_ADMIN_TOKEN.startsWith('CHANGE_ME'))
    throw new Error('请配置随机 IO_ADMIN_TOKEN。');
  return {
    db,
    token: process.env.IO_ADMIN_TOKEN,
    baseUrl: `http://${process.env.IO_ADDR || '127.0.0.1:17890'}`,
  };
}
