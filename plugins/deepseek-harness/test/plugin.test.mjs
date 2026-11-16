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
    apply(ctx, { baseUrl: 'http://127.0.0.1:17890', tokenEnv: 'IO_PLUGIN_TEST_TOKEN', stateDir: '.unused', telemetryBindings: [] });
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
