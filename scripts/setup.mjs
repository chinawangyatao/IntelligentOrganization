import { loadEnv } from './env.mjs';
import { startDatabase } from './database.mjs';
loadEnv({ create: true });
await startDatabase();
console.log('本地配置就绪。pnpm dev 启动；桌面连接令牌使用 .env 中的 IO_ADMIN_TOKEN。');
