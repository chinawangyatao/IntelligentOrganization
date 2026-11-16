import { api } from './client.mjs';
const projects = await api('/projects');
if (projects.some((p) => p.name === '订单协作试点')) {
  console.log('演示项目已存在，保留当前数据。');
  process.exit(0);
}
const directory = await api('/members');
const names = ['林知夏 · 产品', '陈序 · 前端', '周予安 · 后端', '许清 · 测试'];
const members = [];
for (const name of names) {
  let member = directory.find((m) => m.name === name);
  if (!member) {
    const result = await api('/members', { method: 'POST', body: { name, role: 'member' } });
    member = result.member;
  }
  members.push(member);
}
const p = await api('/projects', {
  method: 'POST',
  body: {
    name: '订单协作试点',
    description: '用于体验产品、前后端与测试的协作交接。内容为演示数据；模型调用用量不伪造。',
  },
});
const prefix = `/projects/${p.id}`;
const initial = await api(`${prefix}/snapshot`);
const assignments = [
  ['产品经理', [members[0]]],
  ['前端开发', [members[1]]],
  ['后端开发', [members[2]]],
  ['测试', [members[3]]],
];
for (const [name, people] of assignments) {
  const node = initial.nodes.find((n) => n.name === name);
  if (node)
    await api(`${prefix}/nodes/${node.id}`, {
      method: 'PATCH',
      body: { ownerIds: people.map((m) => m.id), memberIds: people.map((m) => m.id) },
    });
}
await api(`${prefix}/memories`, {
  method: 'POST',
  body: {
    title: '订单取消规则 · 已确认',
    kind: 'requirement',
    status: 'published',
    content:
      '仅待付款订单可以取消。已付款订单进入退款申请流程。取消后释放库存；重复取消应返回相同结果。验收需覆盖状态边界、库存回补及重复请求。',
  },
});
await api(`${prefix}/memories`, {
  method: 'POST',
  body: {
    title: '团队交接约定',
    kind: 'decision',
    status: 'published',
    content:
      '每项工作领取后先同步上下文；提交成果时附文档或代码版本及验证结果。讨论提出的变更经负责人确认后再发布为项目记忆。',
  },
});
await api(`${prefix}/memories`, {
  method: 'POST',
  body: {
    title: '退款流程待确认',
    kind: 'contract',
    status: 'draft',
    content: '待产品负责人确认：退款审批的角色及超时处理。当前为草稿，不作为开发依据。',
  },
});
for (const [name, people] of assignments) {
  const node = initial.nodes.find((n) => n.name === name);
  if (!node) continue;
  await api(`${prefix}/tasks`, {
    method: 'POST',
    body: {
      nodeId: node.id,
      title: {
        产品经理: '确认订单取消与退款边界',
        前端开发: '实现订单详情与取消交互',
        后端开发: '实现取消接口与库存释放',
        测试: '编写状态边界与幂等测试',
      }[name],
      description: '请先领取当前已发布上下文，完成后提交带版本的成果。',
      ownerId: people[0].id,
      collaboratorIds: [],
      reviewerId: 'admin',
      acceptanceCriteria: '覆盖已确认业务规则，提供成果版本和验证记录。',
    },
  });
}
const conversation = await api('/conversations', {
  method: 'POST',
  body: { kind: 'project', projectId: p.id, name: '项目协作' },
});
await api(`/conversations/${conversation.id}/messages`, {
  method: 'POST',
  body: {
    body: '欢迎进入订单协作试点。请在各自任务中同步共享上下文；业务疑问在对应任务讨论，确认的结论再发布为共享记忆。',
  },
});
console.log('已创建演示项目、成员、任务、记忆与项目讨论；未生成虚假的模型消耗。');
