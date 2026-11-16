import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const parse = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = await parse('plugin.json');
assert.equal(manifest.name, 'intelligent-organization');
assert.equal(manifest.version, '0.2.0');
assert.equal(manifest.extensions['com.openai'].hooks, './hooks/hooks.json');
assert.equal((await parse('package.json')).version, manifest.version);
const compatibility = await parse('.codex-plugin/plugin.json');
assert.equal(compatibility.version, manifest.version);
assert.equal(compatibility.hooks, './hooks/hooks.json');
const mcp = await parse('mcp.json');
assert.equal(mcp.mcpServers['intelligent-organization'].type, 'stdio');
assert.equal(mcp.mcpServers['intelligent-organization'].args[0], '${PLUGIN_ROOT}/runtime/server.cjs');
assert.deepEqual(mcp, await parse('.mcp.json'));
const hooks = await parse('hooks/hooks.json');
for (const event of ['SessionStart', 'UserPromptSubmit', 'PostCompact']) {
  const hook = hooks.hooks[event][0].hooks[0];
  assert.equal(hook.type, 'mcp_tool');
  assert.equal(hook.server, 'intelligent-organization');
  assert.equal(hook.tool, 'organization_bound_context');
  assert.equal(hook.input.event, event);
}
if (process.argv.includes('--runtime')) {
  assert.ok((await stat(new URL('runtime/server.cjs', root))).size > 1000, 'build the self-contained runtime first');
  assert.equal(await readFile(new URL('runtime/launcher.cjs', root), 'utf8'), await readFile(new URL('src/launcher.cjs', root), 'utf8'));
  assert.deepEqual(await parse('runtime/hooks.json'), hooks);
}
await stat(new URL('scripts/build.mjs', root));
assert.match(await readFile(new URL('skills/project-collaboration/SKILL.md', root), 'utf8'), /organization_task_context/);
console.log('Codex portable and compatibility plugin manifests validated; host installation still requires a live smoke test.');
