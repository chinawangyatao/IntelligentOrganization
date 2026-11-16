import { useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, MessageSquare, Plus } from 'lucide-react';
import { Modal, PageHeader } from '../components';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { AppSelect, AppSelectOption } from '@/components/AppSelect';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { memberName, formatTime } from '../types';
import type { Issue, PageProps } from '../types';

const statusLabels = { open: '待接单', acknowledged: '处理中', resolved: '已解决' };
export default function Issues({ data, members, me, api, run, busy, onDiscuss }: PageProps) {
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState('active');
  const emptyForm = {
    nodeId: data.nodes[0]?.id || '',
    taskId: '',
    title: '',
    description: '',
    assigneeId: '',
  };
  const [form, setForm] = useState(emptyForm);
  const items = data.issues.filter(
    (issue) =>
      filter === 'all' ||
      (filter === 'active' ? issue.status !== 'resolved' : issue.status === 'resolved'),
  );
  const projectMembers = members.filter(
    (member) =>
      member.active &&
      (member.role === 'admin' ||
        data.nodes.some(
          (node) => node.memberIds.includes(member.id) || node.ownerIds.includes(member.id),
        )),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="问题与反馈"
        description="关联工作项、指定处理人，跟进接单与解决状态。"
        actions={
          <Button
            onClick={() => {
              setForm(emptyForm);
              setCreate(true);
            }}
          >
            <Plus data-icon="inline-start" />
            提出问题
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="active">待处理</TabsTrigger>
            <TabsTrigger value="resolved">已解决</TabsTrigger>
            <TabsTrigger value="all">全部问题</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-sm text-muted-foreground">
          {data.issues.filter((issue) => issue.status === 'open').length} 个问题等待接单
        </span>
      </div>
      {items.length ? (
        <div className="flex flex-col gap-4">
          {items.map((issue) => (
            <Card key={issue.id}>
              <CardHeader>
                <CardTitle>{issue.title}</CardTitle>
                <CardDescription>
                  {data.nodes.find((node) => node.id === issue.nodeId)?.name} ·{' '}
                  {memberName(members, issue.assigneeId)} 处理 · {formatTime(issue.createdAt)}
                </CardDescription>
                <CardAction>
                  <Badge
                    variant={
                      issue.status === 'resolved'
                        ? 'outline'
                        : issue.status === 'acknowledged'
                          ? 'default'
                          : 'secondary'
                    }
                  >
                    {statusLabels[issue.status]}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="whitespace-pre-wrap break-words text-sm leading-7">
                  {issue.description || '暂无补充说明'}
                </p>
                {issue.taskId && (
                  <p className="text-sm text-muted-foreground">
                    关联工作项：
                    {data.tasks.find((task) => task.id === issue.taskId)?.title || issue.taskId}
                  </p>
                )}
              </CardContent>
              <CardFooter className="flex-wrap justify-between gap-3">
                <div>
                  {onDiscuss && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        onDiscuss({ kind: 'issue', projectId: data.project.id, issueId: issue.id })
                      }
                    >
                      <MessageSquare data-icon="inline-start" />
                      关联讨论
                    </Button>
                  )}
                </div>
                {(me.role === 'admin' || me.id === issue.assigneeId) &&
                  issue.status !== 'resolved' && (
                    <div className="flex gap-2">
                      {issue.status === 'open' && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                api(
                                  `/api/projects/${data.project.id}/issues/${issue.id}`,
                                  'PATCH',
                                  { status: 'acknowledged' },
                                ),
                              '已接单',
                            )
                          }
                        >
                          接单处理
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      )}
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              api(`/api/projects/${data.project.id}/issues/${issue.id}`, 'PATCH', {
                                status: 'resolved',
                              }),
                            '问题已关闭',
                          )
                        }
                      >
                        <CheckCircle2 data-icon="inline-start" />
                        确认解决
                      </Button>
                    </div>
                  )}
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {filter === 'resolved' ? <CheckCircle2 /> : <AlertCircle />}
                </EmptyMedia>
                <EmptyTitle>
                  {filter === 'resolved' ? '还没有已解决的问题' : '当前没有待处理问题'}
                </EmptyTitle>
                <EmptyDescription>
                  发现问题后，关联节点和工作项，交给对应负责人处理。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      )}
      {create && (
        <Modal
          title="提出问题"
          subtitle="描述问题与影响，并指定处理负责人。"
          onClose={() => setCreate(false)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run(
                () =>
                  api<Issue>(`/api/projects/${data.project.id}/issues`, 'POST', {
                    ...form,
                    taskId: form.taskId || undefined,
                  }),
                '问题已提交',
              );
              if (result) setCreate(false);
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="issue-title">问题标题</FieldLabel>
                <Input
                  id="issue-title"
                  required
                  autoFocus
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </Field>
              <FieldGroup className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="issue-node">关联节点</FieldLabel>
                  <AppSelect
                    id="issue-node"
                    required
                    value={form.nodeId}
                    onValueChange={(value) => setForm({ ...form, nodeId: value, taskId: '' })}
                  >
                    {data.nodes.map((node) => (
                      <AppSelectOption key={node.id} value={node.id}>
                        {node.name}
                      </AppSelectOption>
                    ))}
                  </AppSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="issue-assignee">处理负责人</FieldLabel>
                  <AppSelect
                    id="issue-assignee"
                    required
                    value={form.assigneeId}
                    onValueChange={(value) => setForm({ ...form, assigneeId: value })}
                  >
                    <AppSelectOption value="">选择负责人</AppSelectOption>
                    {projectMembers.map((member) => (
                      <AppSelectOption key={member.id} value={member.id}>
                        {member.name}
                      </AppSelectOption>
                    ))}
                  </AppSelect>
                </Field>
              </FieldGroup>
              <Field>
                <FieldLabel htmlFor="issue-task">关联工作项</FieldLabel>
                <AppSelect
                  id="issue-task"
                  value={form.taskId}
                  onValueChange={(value) => setForm({ ...form, taskId: value })}
                >
                  <AppSelectOption value="">不关联工作项</AppSelectOption>
                  {data.tasks
                    .filter((task) => task.nodeId === form.nodeId)
                    .map((task) => (
                      <AppSelectOption key={task.id} value={task.id}>
                        {task.title}
                      </AppSelectOption>
                    ))}
                </AppSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="issue-description">问题、证据与影响</FieldLabel>
                <Textarea
                  id="issue-description"
                  required
                  rows={6}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="复现步骤、期望结果、实际结果，或需要确认的业务规则"
                />
              </Field>
              <Field orientation="horizontal" className="justify-end">
                <Button type="button" variant="outline" onClick={() => setCreate(false)}>
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy || !form.assigneeId || !form.title.trim() || !form.description.trim()
                  }
                >
                  提交问题
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </Modal>
      )}
    </div>
  );
}
