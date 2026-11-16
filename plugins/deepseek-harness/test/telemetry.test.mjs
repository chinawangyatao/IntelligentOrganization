import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usageForEvent, UsageOutbox } from '../lib/telemetry.js';

const binding = { sessionId: 'session-1', projectId: 'project-1', taskId: 'task-1' };
const session = { id: 'session-1', requestContext: () => ({ provider: 'deepseek', model: 'actual-route-model' }) };

test('normalize disjoint provider buckets and count durable attempts separately', () => {
  const event = { type: 'assistant/message', seq: 12, data: { turn: 1, step: 1, usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 5, reasoningTokens: 8 } } };
  const first = usageForEvent(session, event, binding);
  assert.equal(first.inputTokens, 125);
  assert.equal(first.outputTokens, 10);
  assert.equal(first.cacheReadTokens, 100);
  assert.equal(first.model, 'actual-route-model');
  assert.equal(first.requestId, usageForEvent(session, event, binding).requestId);
  const retry = usageForEvent(session, { type: 'assistant/attempt', seq: 11, data: { stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 50, outputTokens: 2 } } }] } }, binding);
  assert.notEqual(first.requestId, retry.requestId);
  assert.equal(retry.inputTokens, 50);
  assert.equal(retry.costSource, 'unknown');
});

test('do not invent accounting or collect unbound sessions', () => {
  assert.equal(usageForEvent({ ...session, id: 'private-session' }, { type: 'assistant/message', seq: 1, data: { usage: { inputTokens: 1, outputTokens: 2 } } }, binding), undefined);
  assert.equal(usageForEvent(session, { type: 'assistant/message', seq: 1, data: {} }, binding), undefined);
  assert.equal(usageForEvent({ id: 'session-1' }, { type: 'assistant/message', seq: 1, data: { usage: { inputTokens: 1, outputTokens: 2 } } }, binding), undefined);
  assert.equal(usageForEvent(session, { type: 'assistant/message', data: { usage: { inputTokens: 1, outputTokens: 2 } } }, binding), undefined);
});

test('usage outbox retains failed records and removes only acknowledged uploads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'io-telemetry-'));
  let online = false;
  const sent = [];
  let failures = 0;
  const outbox = new UsageOutbox(directory, { request: async (method, path, body) => { if (!online) throw new Error('offline'); sent.push({ method, path, body }); return { id: 'usage-1' }; } }, () => { failures++; });
  try {
    await outbox.enqueue({ projectId: 'project-1', requestId: 'stable-1', inputTokens: 10 });
    await outbox.flush();
    assert.equal((await readdir(directory)).length, 1);
    assert.equal(failures, 1);
    online = true;
    await outbox.flush();
    assert.equal((await readdir(directory)).length, 0);
    assert.equal(sent[0].path, '/projects/project-1/usage');
    assert.equal(sent[0].body.requestId, 'stable-1');
    assert.equal(sent[0].body.projectId, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('route attribution uses the context effective at the durable event sequence', () => {
  const sessionWithBatch = { id: 'session-1', snapshotEvents: () => [
    { type: 'request/context', seq: 3, data: { provider: 'provider-a', model: 'model-a' } },
    { type: 'request/context', seq: 9, data: { provider: 'provider-b', model: 'model-b' } },
  ], requestContext: () => ({ provider: 'provider-b', model: 'model-b' }) };
  const value = usageForEvent(sessionWithBatch, { type: 'assistant/message', seq: 8, data: { usage: { inputTokens: 20, outputTokens: 2 } } }, binding);
  assert.equal(value.provider, 'provider-a');
  assert.equal(value.model, 'model-a');
});
