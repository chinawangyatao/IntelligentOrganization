import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL('../../mcp-bridge/src/cli.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('runtime/server.cjs', root)),
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  legalComments: 'linked', sourcemap: false,
});
await copyFile(new URL('src/launcher.cjs', root), new URL('runtime/launcher.cjs', root));
await copyFile(new URL('hooks/hooks.json', root), new URL('runtime/hooks.json', root));
