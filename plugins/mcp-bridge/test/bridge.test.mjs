import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OrganizationClient, validateBaseUrl } from '../dist/index.js';

const cli = process.env.IO_MCP_TEST_CLI ?? fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const token = 'fixture-member-token';
const decode = result => JSON.parse(result.content.find(x => x.type === 'text').text);

test('reject unsafe service URLs before transmitting credentials', () => {
  assert.throws(() => validateBaseUrl('http://remote.example'));
  assert.throws(() => validateBaseUrl('https://user:secret@service.example'));
  assert.throws(() => validateBaseUrl('https://service.example?token=secret'));
  assert.equal(validateBaseUrl('http://127.0.0.1:17890/'), 'http://127.0.0.1:17890');
});

test('stdio MCP discovers real tools, forwards auth, enforces host identity and surfaces conflicts', async () => {
  const requests = [];
  const api = createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : undefined;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; res.end('{"error":"unauthorized"}'); return; }
    if (req.url === '/api/projects') { res.end('[{"id":"p1","name":"Pilot"}]'); return; }
    if (req.url === '/api/projects/p1/tasks/t1/context') { res.end('{"stale":true,"task":{"id":"t1","version":3},"memories":[],"changes":[]}'); return; }
    if (req.url === '/api/projects/p1/tasks/t1/submit') { res.statusCode = 409; res.end('{"error":"memory baseline changed","code":"stale_memory"}'); return; }
    if (req.url === '/api/conversations/c1/messages' && req.method === 'POST') { res.end(JSON.stringify({ id: 'm1', ...body })); return; }
    if (req.url === '/api/projects/p1/memories/m1/history') { res.end('[{"id":"m1","version":2,"status":"published"}]'); return; }
    if (req.url === '/api/projects/p1/usage') { res.end(JSON.stringify({ id: 'u1', ...body, memberId: 'authenticated-member' })); return; }
    res.end('{}');
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli], env: { IO_SERVICE_URL: `http://127.0.0.1:${address.port}`, IO_MEMBER_TOKEN: token, IO_HOST: 'fixture-host', PATH: process.env.PATH } });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 18);
    const send = tools.find(x => x.name === 'organization_send_message');
    assert.equal(send.annotations.readOnlyHint, false);
    assert.match(send.description, /explicitly asked/);
    assert.ok(!tools.find(x => x.name === 'organization_memory_update').inputSchema.properties.status);
    const refusedPublish = await client.callTool({ name: 'organization_memory_update', arguments: { projectId: 'p1', memoryId: 'm1', version: 2, content: 'AI must not alter a published decision' } });
    assert.equal(refusedPublish.isError, true);
    assert.equal(decode(refusedPublish).code, 'human_publication_required');
    assert.ok(!requests.some(x => x.method === 'PATCH' && x.url === '/api/projects/p1/memories/m1'));
    assert.ok(!tools.find(x => x.name === 'organization_usage_record').inputSchema.properties.memberId);
    assert.deepEqual(decode(await client.callTool({ name: 'organization_projects', arguments: {} })), [{ id: 'p1', name: 'Pilot' }]);
    assert.equal(decode(await client.callTool({ name: 'organization_task_context', arguments: { projectId: 'p1', taskId: 't1' } })).stale, true);
    const conflict = await client.callTool({ name: 'organization_task_submit', arguments: { projectId: 'p1', taskId: 't1', version: 3, deliverable: 'commit abc; tests pass' } });
    assert.equal(conflict.isError, true);
    assert.equal(decode(conflict).status, 409);
    assert.equal(decode(conflict).code, 'stale_memory');
    const message = await client.callTool({ name: 'organization_send_message', arguments: { conversationId: 'c1', body: 'User requested project update' } });
    assert.equal(decode(message).id, 'm1');
    const usage = await client.callTool({ name: 'organization_usage_record', arguments: { projectId: 'p1', requestId: 'real-request-1', provider: 'example', model: 'example-model', inputTokens: 120, outputTokens: 20, cacheReadTokens: 100 } });
    assert.equal(decode(usage).host, 'fixture-host');
    assert.ok(requests.every(x => x.authorization === `Bearer ${token}`));
    const submit = requests.find(x => x.url.endsWith('/submit'));
    assert.deepEqual(Object.keys(submit.body).sort(), ['deliverable', 'version']);
  } finally {
    await client.close();
    await new Promise(resolve => api.close(resolve));
  }
});

test('API errors redact credential text', async () => {
  const client = new OrganizationClient({ baseUrl: 'https://service.example', token }, async () => new Response(JSON.stringify({ error: `bad ${token}` }), { status: 403 }));
  await assert.rejects(() => client.request('GET', '/me'), error => error.status === 403 && !error.message.includes(token));
});
