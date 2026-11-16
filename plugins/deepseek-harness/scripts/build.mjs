import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL('src/index.ts', root))],
  outfile: fileURLToPath(new URL('lib/index.js', root)),
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'],
  legalComments: 'linked',
});
await build({
  entryPoints: [fileURLToPath(new URL('../../mcp-bridge/src/cli.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('runtime/server.cjs', root)),
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  legalComments: 'linked',
});
