import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'io-live-smoke', version: '0.1.0' });
if (!process.env.IO_MEMBER_TOKEN) throw new Error('IO_MEMBER_TOKEN must be set');
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url))], env: { ...process.env, IO_HOST: 'integration-smoke' } });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(t => t.name === 'organization_task_context'));
  for (const name of ['organization_identity', 'organization_projects', 'organization_list_conversations']) {
    const result = await client.callTool({ name, arguments: {} });
    assert.ok(!result.isError, `${name} returned an error`);
    const data = JSON.parse(result.content.find(c => c.type === 'text').text);
    console.log(`${name}: OK (${Array.isArray(data) ? `${data.length} records` : 'authenticated identity'})`);
  }
} finally { await client.close(); }
