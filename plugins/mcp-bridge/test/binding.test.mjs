import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cli =
  process.env.IO_MCP_TEST_CLI ?? fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const decode = (result) => JSON.parse(result.content.find((x) => x.type === 'text').text);
async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    env: { PATH: process.env.PATH, IO_MEMBER_TOKEN: '', ...env },
  });
  const client = new Client({ name: 'binding-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'io-mcp-binding-'));
  const calls = [];
  const grants = new Map();
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    calls.push({ method: req.method, url: req.url, body, thread: req.headers['x-io-thread-id'] });
    res.setHeader('Content-Type', 'application/json');
    const grant = grants.get(req.headers.authorization?.slice(7));
    if (!grant) {
      res.statusCode = 401;
      res.end('{"error":"unauthorized"}');
      return;
    }
    if (req.url === '/api/agent/session') {
      res.end(JSON.stringify(grant.session));
      return;
    }
    if (req.url === '/api/agent/context') {
      res.end(
        JSON.stringify({
          session: grant.session,
          context: {
            task: { id: grant.session.taskId, version: 4 },
            memories: [
              {
                id: 'm-' + grant.session.taskId,
                title: 'Approved rule',
                status: 'published',
                content: 'Only the assigned feature',
                version: 2,
              },
            ],
            issues: [],
            stale: true,
            changes: [{ id: 'm-' + grant.session.taskId, version: 2 }],
          },
        }),
      );
      return;
    }
    if (req.url === '/api/me') {
      res.end(JSON.stringify({ id: grant.session.memberId, role: 'member' }));
      return;
    }
    res.end(JSON.stringify({ id: 'result', ...body }));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${api.address().port}`;
  async function profile(suffix) {
    const session = {
      id: 'binding-' + suffix,
      serviceInstanceId: 'service-fixture',
      memberId: 'member-' + suffix,
      projectId: 'project-' + suffix,
      taskId: 'task-' + suffix,
      nodeId: 'node-' + suffix,
      host: 'codex',
      nativeSessionId: 'thread-' + suffix,
      status: 'active',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const value = { version: 1, baseUrl, token: 'fixture-scoped-grant-' + suffix, session };
    const dir = join(directory, 'work-sessions', session.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'profile.json');
    await writeFile(file, JSON.stringify(value), { mode: 0o600 });
    grants.set(value.token, value);
    return { value, file };
  }
  return {
    directory,
    baseUrl,
    calls,
    profile,
    close: async () => {
      await new Promise((resolve) => api.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('no environment credential still initializes MCP and gives actionable connection status', async () => {
  const client = await connect({ IO_HOST: 'codex' });
  try {
    const listed = await client.listTools();
    assert(listed.tools.some((t) => t.name === 'organization_connection_status'));
    const status = decode(
      await client.callTool({ name: 'organization_connection_status', arguments: {} }),
    );
    assert.equal(status.connected, false);
    assert.equal(status.code, 'connection_required');
    assert.deepEqual(
      decode(
        await client.callTool({
          name: 'organization_bound_context',
          arguments: { event: 'UserPromptSubmit', turnId: 'fixture', cwd: '/tmp' },
        }),
      ),
      {},
    );

    assert.match(status.message, /App/);
    const data = await client.callTool({ name: 'organization_projects', arguments: {} });
    assert.equal(data.isError, true);
    assert.equal(decode(data).code, 'connection_required');
  } finally {
    await client.close();
  }
});

test('two explicit binding profiles never cross projects and metadata rejects another/forked thread', async () => {
  const f = await fixture();
  const a = await f.profile('a'),
    b = await f.profile('b');
  const ca = await connect({ IO_BINDING_FILE: a.file, IO_HOST: 'codex' }),
    cb = await connect({ IO_BINDING_FILE: b.file, IO_HOST: 'codex' });
  try {
    const first = decode(
      await ca.callTool({
        name: 'organization_bound_task_context',
        arguments: {},
        _meta: { threadId: 'thread-a' },
      }),
    );
    const second = decode(
      await cb.callTool({
        name: 'organization_bound_task_context',
        arguments: {},
        _meta: { threadId: 'thread-b' },
      }),
    );
    assert.equal(first.context.task.id, 'task-a');
    assert.equal(second.context.task.id, 'task-b');
    assert.deepEqual(
      f.calls.filter((c) => c.url === '/api/agent/context').map((c) => c.thread),
      ['thread-a', 'thread-b'],
    );
    const noMetadata = await ca.callTool({
      name: 'organization_bound_task_context',
      arguments: {},
    });
    assert.equal(decode(noMetadata).code, 'binding_thread_required');
    const before = f.calls.length;
    const mismatch = await ca.callTool({
      name: 'organization_bound_task_context',
      arguments: {},
      _meta: { threadId: 'thread-b' },
    });
    assert.equal(decode(mismatch).code, 'binding_mismatch');
    assert.equal(f.calls.length, before);
    const foreign = await ca.callTool({
      name: 'organization_task_context',
      arguments: { projectId: 'project-b', taskId: 'task-b' },
      _meta: { threadId: 'thread-a' },
    });
    assert.equal(decode(foreign).code, 'binding_mismatch');
    assert.equal(f.calls.length, before);
    const hook = decode(
      await ca.callTool({
        name: 'organization_bound_context',
        arguments: { hookEventName: 'PostCompact' },
        _meta: { threadId: 'thread-a' },
      }),
    );
    assert.equal(hook.hookSpecificOutput.hookEventName, 'PostCompact');
    assert.match(hook.hookSpecificOutput.additionalContext, /project-a/);
    assert(!JSON.stringify(hook).includes(a.value.token));
    assert(!f.calls.some((c) => c.method === 'POST'));
    await writeFile(a.file, JSON.stringify(b.value), { mode: 0o600 });
    const changed = await ca.callTool({ name: 'organization_bound_task_context', arguments: {} });
    assert.equal(decode(changed).code, 'binding_changed');
  } finally {
    await Promise.all([ca.close(), cb.close()]);
    await f.close();
  }
});

test('global plugin resolves only exact host/thread index, never legacy sessionId or a current project', async () => {
  const f = await fixture();
  const a = await f.profile('a'),
    b = await f.profile('b');
  const index = join(f.directory, 'work-sessions', 'threads', 'codex');
  await mkdir(index, { recursive: true, mode: 0o700 });
  for (const p of [a, b])
    await writeFile(
      join(index, p.value.session.nativeSessionId + '.json'),
      JSON.stringify({
        bindingId: p.value.session.id,
        host: 'codex',
        nativeSessionId: p.value.session.nativeSessionId,
      }),
      { mode: 0o600 },
    );
  const client = await connect({
    IO_HOST: 'codex',
    IO_APP_DATA_DIR: f.directory,
    IO_MEMBER_TOKEN: 'broad-token-must-not-win-over-thread-binding',
  });
  try {
    const call = (threadId) =>
      client.callTool({
        name: 'organization_bound_task_context',
        arguments: {},
        _meta: { threadId },
      });
    assert.equal(decode(await call('thread-a')).context.task.id, 'task-a');
    assert.equal(decode(await call('thread-b')).context.task.id, 'task-b');
    assert.equal(
      decode(
        await client.callTool({
          name: 'organization_bound_task_context',
          arguments: {},
          _meta: { sessionId: 'thread-a' },
        }),
      ).code,
      'binding_required',
    );
    assert.equal(decode(await call('unbound-fork')).code, 'binding_required');
    await writeFile(
      join(index, 'thread-a.json'),
      JSON.stringify({
        bindingId: a.value.session.id,
        host: 'codex',
        nativeSessionId: 'thread-a',
        revoked: true,
      }),
      { mode: 0o600 },
    );
    await rm(a.file);
    const revoked = decode(
      await client.callTool({
        name: 'organization_bound_context',
        arguments: { event: 'UserPromptSubmit' },
        _meta: { threadId: 'thread-a' },
      }),
    );
    assert.match(revoked.hookSpecificOutput.additionalContext, /binding_revoked/);
    assert.equal(decode(await call('thread-a')).code, 'binding_revoked');
    await rm(join(index, 'thread-b.json'));
    const missing = decode(
      await client.callTool({
        name: 'organization_bound_context',
        arguments: { event: 'UserPromptSubmit' },
        _meta: { threadId: 'thread-b' },
      }),
    );
    assert.match(missing.hookSpecificOutput.additionalContext, /binding_missing/);
    assert.equal(decode(await call('thread-b')).code, 'binding_missing');
  } finally {
    await client.close();
    await f.close();
  }
});

test('unsafe permissions/symlinks, expired grants and unproven activation fail closed', async () => {
  const f = await fixture();
  const a = await f.profile('a');
  await chmod(a.file, 0o644);
  let client = await connect({ IO_BINDING_FILE: a.file, IO_HOST: 'codex' });
  try {
    assert.equal(
      decode(await client.callTool({ name: 'organization_bound_task_context', arguments: {} }))
        .code,
      'unsafe_binding_file',
    );
  } finally {
    await client.close();
  }
  await chmod(a.file, 0o600);
  const link = join(f.directory, 'linked-profile.json');
  await symlink(a.file, link);
  client = await connect({ IO_BINDING_FILE: link, IO_HOST: 'codex' });
  try {
    assert.equal(
      decode(await client.callTool({ name: 'organization_bound_task_context', arguments: {} }))
        .code,
      'unsafe_binding_file',
    );
  } finally {
    await client.close();
  }
  a.value.session.expiresAt = new Date(Date.now() - 1000).toISOString();
  await writeFile(a.file, JSON.stringify(a.value));
  client = await connect({ IO_BINDING_FILE: a.file, IO_HOST: 'codex' });
  try {
    assert.equal(
      decode(await client.callTool({ name: 'organization_bound_task_context', arguments: {} }))
        .code,
      'binding_expired',
    );
  } finally {
    await client.close();
  }
  a.value.session.expiresAt = new Date(Date.now() + 3600000).toISOString();
  a.value.session.status = 'prepared';
  delete a.value.session.nativeSessionId;
  await writeFile(a.file, JSON.stringify(a.value));
  client = await connect({ IO_BINDING_FILE: a.file, IO_HOST: 'codex' });
  try {
    assert.equal(
      decode(await client.callTool({ name: 'organization_bound_task_context', arguments: {} }))
        .code,
      'binding_not_active',
    );
  } finally {
    await client.close();
    await f.close();
  }
});

test('hook CLI emits only additionalContext JSON, never changes the task baseline', async () => {
  const f = await fixture();
  const a = await f.profile('a');
  try {
    const child = spawn(process.execPath, [cli, '--hook', 'UserPromptSubmit'], {
      env: {
        PATH: process.env.PATH,
        IO_BINDING_FILE: a.file,
        IO_HOST: 'codex',
        IO_MEMBER_TOKEN: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.stdin.end(JSON.stringify({ nativeSessionId: 'thread-a' }));
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0, err);
    const value = JSON.parse(out);
    assert.equal(value.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(value.hookSpecificOutput.additionalContext, /task-a/);
    assert(!out.includes(a.value.token));
    assert(!f.calls.some((c) => c.method === 'POST'));
  } finally {
    await f.close();
  }
});
