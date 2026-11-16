import assert from 'node:assert/strict';
import { api } from './client.mjs';

if (process.env.IO_ISOLATED_FLOW !== '1') {
  throw new Error('请使用 pnpm test:flow，在独立测试空间执行，避免污染试用数据。');
}
const suffix = Date.now().toString(36);
const createMember = async (name) =>
  api('/members', { method: 'POST', body: { name: `验证-${suffix}-${name}`, role: 'member' } });
const alice = await createMember('前端');
const bob = await createMember('接手');
const outsider = await createMember('无项目权限');
const project = await api('/projects', {
  method: 'POST',
  body: { name: `端到端验证 ${suffix}`, description: 'API 自动验证创建的项目；保留作为审计记录。' },
});
const prefix = `/projects/${project.id}`;
let snapshot = await api(`${prefix}/snapshot`);
const node = snapshot.nodes.find((n) => n.name === '前端开发') || snapshot.nodes[0];
await api(`${prefix}/nodes/${node.id}`, {
  method: 'PATCH',
  body: { ownerIds: [alice.member.id], memberIds: [alice.member.id, bob.member.id] },
});
await api(`${prefix}/snapshot`, { token: outsider.token, expected: 403 });
const memory = await api(`${prefix}/memories`, {
  method: 'POST',
  body: { title: '取消规则', content: '仅待付款可取消', kind: 'requirement', status: 'published' },
});
let task = await api(`${prefix}/tasks`, {
  method: 'POST',
  body: {
    nodeId: node.id,
    title: '订单取消按钮',
    ownerId: alice.member.id,
    reviewerId: 'admin',
    collaboratorIds: [],
    acceptanceCriteria: '状态边界与重复操作正确',
  },
});
const notices = await api('/notifications', { token: alice.token });
const assigned = notices.find((n) => n.taskId === task.id);
assert(assigned, 'task assignment must notify its owner');
await api(`/notifications/${assigned.id}/read`, {
  token: bob.token,
  method: 'POST',
  expected: 404,
});
await api(`/notifications/${assigned.id}/read`, { token: alice.token, method: 'POST' });
assert.equal((await api(`${prefix}/snapshot`)).tasks.find((t) => t.id === task.id).status, 'todo');
task = await api(`${prefix}/tasks/${task.id}/sync`, {
  token: alice.token,
  method: 'POST',
  body: { version: task.version },
});
await api(`${prefix}/memories/${memory.id}`, {
  method: 'PATCH',
  body: {
    version: memory.version,
    content: '仅待付款可取消，并弹出确认对话框',
    status: 'published',
  },
});
await api(`${prefix}/tasks/${task.id}/submit`, {
  token: alice.token,
  method: 'POST',
  body: { version: task.version, deliverable: '基于旧版的成果' },
  expected: 409,
});
task = await api(`${prefix}/tasks/${task.id}/sync`, {
  token: alice.token,
  method: 'POST',
  body: { version: task.version },
});
task = await api(`${prefix}/tasks/${task.id}/submit`, {
  token: alice.token,
  method: 'POST',
  body: {
    version: task.version,
    deliverable: '已按新版规则实现并验证：示例提交 abc123；边界用例通过',
  },
});
await api(`${prefix}/tasks/${task.id}`, {
  token: alice.token,
  method: 'PATCH',
  body: { version: task.version, status: 'done' },
  expected: 403,
});
task = await api(`${prefix}/tasks/${task.id}`, {
  method: 'PATCH',
  body: { version: task.version, status: 'done' },
});
assert.equal(task.status, 'done');
const usage = {
  requestId: `check-${suffix}`,
  nodeId: node.id,
  taskId: task.id,
  host: 'verification',
  provider: 'fixture',
  model: 'test-accounting',
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 40,
  costSource: 'unknown',
};
const u1 = await api(`${prefix}/usage`, { token: alice.token, method: 'POST', body: usage });
const u2 = await api(`${prefix}/usage`, { token: alice.token, method: 'POST', body: usage });
assert.equal(u1.id, u2.id);
const conv = await api('/conversations', {
  token: alice.token,
  method: 'POST',
  body: { kind: 'direct', participantIds: [bob.member.id] },
});
const msg = await api(`/conversations/${conv.id}/messages`, {
  token: alice.token,
  method: 'POST',
  body: { body: '交接时请检查新版规则。', mentionIds: [bob.member.id] },
});
await api(`/conversations/${conv.id}/messages`, { expected: 403 });
const listed = await api('/conversations', { token: bob.token });
assert(listed.find((c) => c.id === conv.id).unreadCount >= 1);
await api(`/conversations/${conv.id}/read`, {
  token: bob.token,
  method: 'POST',
  body: { messageId: msg.id },
});
const draft = await api(`/conversations/${conv.id}/messages/${msg.id}/promote`, {
  token: alice.token,
  method: 'POST',
  body: { projectId: project.id, nodeId: node.id, title: '交接注意事项', kind: 'lesson' },
});
assert.equal(draft.status, 'draft');
const pending = await api(`${prefix}/tasks`, {
  method: 'POST',
  body: { nodeId: node.id, title: '待交接事项', ownerId: alice.member.id, reviewerId: 'admin' },
});
const h = await api(`${prefix}/handovers`, {
  method: 'POST',
  body: {
    fromMemberId: alice.member.id,
    toMemberId: bob.member.id,
    nodeIds: [node.id],
    reason: '验证责任变更',
  },
});
await api(`${prefix}/handovers/${h.id}/accept`, { token: bob.token, method: 'POST' });
snapshot = await api(`${prefix}/snapshot`);
assert.equal(snapshot.tasks.find((t) => t.id === pending.id).ownerId, bob.member.id);
assert.equal(snapshot.tasks.find((t) => t.id === task.id).ownerId, alice.member.id);
const reused = await api(`${prefix}/reuse`, {
  method: 'POST',
  body: { name: `复用验证 ${suffix}`, description: '新项目需求待重新确认', memoryIds: [memory.id] },
});
const copy = await api(`/projects/${reused.id}/snapshot`);
assert(copy.memories.every((m) => m.status === 'draft'));
assert(copy.tasks.every((t) => t.status === 'todo' && !t.ownerId));
assert.equal(copy.usage.length, 0);
console.log(
  '通过：定向通知与已读隔离、权限隔离、记忆变更检查、验收权限、用量去重、私聊隔离/未读、提炼草稿、责任移交保留历史、项目复用重置。',
);
