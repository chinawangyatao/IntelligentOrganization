import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../lib/index.js';

// Contract test for the native host extension; this does not install a DSH profile.
test('native plugin registers lifetime-scoped MCP server with a credential reference', () => {
  const old = process.env.IO_PLUGIN_TEST_TOKEN;
  process.env.IO_PLUGIN_TEST_TOKEN = 'fixture-token-do-not-log';
  const registrations = [];
  const ctx = { mcpManager: { register: (...args) => registrations.push(args) } };
  try {
    apply(ctx, {
      baseUrl: 'http://127.0.0.1:17890',
      tokenEnv: 'IO_PLUGIN_TEST_TOKEN',
      stateDir: '.unused',
      telemetryBindings: [],
    });
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0][0], 'intelligent-organization');
    const entry = registrations[0][1];
    assert.equal(entry.transport, 'stdio');
    assert.equal(entry.env.IO_MEMBER_TOKEN, '${credential:IO_PLUGIN_TEST_TOKEN}');
    assert.ok(!JSON.stringify(entry).includes('fixture-token-do-not-log'));
    assert.ok(entry.args[0].endsWith('/runtime/server.cjs'));
    assert.equal(entry.env.IO_HOST, 'deepseek-harness');
  } finally {
    if (old === undefined) delete process.env.IO_PLUGIN_TEST_TOKEN;
    else process.env.IO_PLUGIN_TEST_TOKEN = old;
  }
});

test('missing environment credential keeps MCP registered for connection setup', () => {
  const old = process.env.IO_PLUGIN_TEST_MISSING;
  delete process.env.IO_PLUGIN_TEST_MISSING;
  const registrations = [];
  try {
    apply(
      { mcpManager: { register: (...args) => registrations.push(args) } },
      {
        baseUrl: 'http://127.0.0.1:17890',
        tokenEnv: 'IO_PLUGIN_TEST_MISSING',
        stateDir: '.unused',
        telemetryBindings: [],
      },
    );
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0][1].env.IO_MEMBER_TOKEN, undefined);
  } finally {
    if (old !== undefined) process.env.IO_PLUGIN_TEST_MISSING = old;
  }
});

test('private binding profile replaces broad credential env and prepared DSH is never marked active', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'io-dsh-binding-'));
  const file = join(dir, 'profile.json');
  const profile = {
    version: 1,
    baseUrl: 'http://127.0.0.1:1',
    token: 'fixture-scoped-dsh-grant',
    session: {
      id: 'binding-dsh',
      serviceInstanceId: 'fixture-service',
      memberId: 'fixture-member',
      projectId: 'fixture-project',
      taskId: 'fixture-task',
      nodeId: 'fixture-node',
      host: 'deepseek-harness',
      status: 'prepared',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  await writeFile(file, JSON.stringify(profile), { mode: 0o600 });
  const registrations = [];
  const listeners = [];
  const disposers = [];
  const ctx = {
    mcpManager: { register: (...args) => registrations.push(args) },
    on: (_event, listener) => listeners.push(listener),
    effect: (factory) => disposers.push(factory()),
  };
  try {
    apply(ctx, {
      baseUrl: 'http://127.0.0.1:17890',
      tokenEnv: 'IO_PLUGIN_TEST_MISSING',
      bindingFile: file,
      stateDir: '.unused',
      telemetryBindings: [],
    });
    assert.equal(registrations[0][1].env.IO_BINDING_FILE, file);
    assert.equal(registrations[0][1].env.IO_MEMBER_TOKEN, undefined);
    assert(!JSON.stringify(registrations).includes(profile.token));
    listeners[0](
      { id: 'some-unproven-session' },
      { type: 'assistant/message', seq: 4, data: { usage: { inputTokens: 10, outputTokens: 2 } } },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(after.session.status, 'prepared');
    assert.equal(after.session.nativeSessionId, undefined);
  } finally {
    await Promise.all(disposers.map((dispose) => dispose()));
    await rm(dir, { recursive: true, force: true });
  }
});
