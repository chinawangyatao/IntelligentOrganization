import { useEffect, useState } from 'react';
import {
  Plus,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  MessageSquare,
  Pencil,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AppSelect, AppSelectOption } from '@/components/AppSelect';
import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import {
  Button,
  Empty,
  Field,
  MemberSelect,
  MemberChecks,
  Modal,
  Notice,
  PageHeader,
  PersonAvatar,
} from '../components';
import { statusNames, memberName } from '../types';
import type { PageProps, Task, TaskContext, TaskStatus } from '../types';

export default function Tasks(
  props: PageProps & { focusTaskId?: string; onFocusConsumed?: () => void },
) {
  const { data, members, focusTaskId, onFocusConsumed } = props;
  const [nodeFilter, setNodeFilter] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const [create, setCreate] = useState(false);
  useEffect(() => {
    if (focusTaskId) {
      const task = data.tasks.find((t) => t.id === focusTaskId);
      if (task) {
        setSelected(task);
        onFocusConsumed?.();
      }
    }
  }, [focusTaskId, data.tasks, onFocusConsumed]);
  const tasks = data.tasks.filter((t) => !nodeFilter || t.nodeId === nodeFilter);
  const selectedCurrent = selected
    ? data.tasks.find((t) => t.id === selected.id) || selected
    : null;
  return (
    <>
      <PageHeader
        title="节点与任务"
        description="按节点分工，记录工作依据，提交成果后由负责人验收。"
        actions={
          <Button onClick={() => setCreate(true)}>
            <Plus />
            新建任务
          </Button>
        }
      />
      <div className="flex items-center gap-3">
        <AppSelect
          value={nodeFilter}
          onValueChange={(value) => setNodeFilter(value)}
          aria-label="筛选节点"
        >
          <AppSelectOption value="">全部节点</AppSelectOption>
          {data.nodes.map((n) => (
            <AppSelectOption key={n.id} value={n.id}>
              {n.name}
            </AppSelectOption>
          ))}
        </AppSelect>
        <span className="text-sm text-muted-foreground">{tasks.length} 项工作</span>
        <span className="ml-auto text-sm text-muted-foreground">完成进度以成果验收为准</span>
      </div>
      <div className="min-w-0 overflow-x-auto pb-2">
        <div className="grid min-w-[1100px] grid-cols-5 items-start gap-4">
          {(['todo', 'in_progress', 'review', 'done', 'blocked'] as TaskStatus[]).map((status) => (
            <section key={status} className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3">
              <div className="flex items-center justify-between px-1 py-1">
                <h2 className="text-sm font-medium">{statusNames[status]}</h2>
                <Badge variant="secondary">{tasks.filter((t) => t.status === status).length}</Badge>
              </div>
              {tasks
                .filter((t) => t.status === status)
                .map((t) => (
                  <Card key={t.id} size="sm">
                    <CardHeader>
                      <CardDescription>
                        {data.nodes.find((n) => n.id === t.nodeId)?.name}
                      </CardDescription>
                      <CardTitle>
                        <button
                          className="text-left hover:underline"
                          onClick={() => setSelected(t)}
                        >
                          {t.title}
                        </button>
                      </CardTitle>
                      <CardAction>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="查看任务"
                          onClick={() => setSelected(t)}
                        >
                          <ArrowUpRight />
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      {t.description && (
                        <p className="line-clamp-3 text-sm text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <BookOpen className="size-3.5" />
                        {Object.keys(t.memoryRefs || {}).length} 条记忆依据
                        <span className="ml-auto">v{t.version}</span>
                      </div>
                    </CardContent>
                    <CardFooter className="gap-2">
                      <PersonAvatar name={memberName(members, t.ownerId)} size="sm" />
                      <span className="truncate text-sm">{memberName(members, t.ownerId)}</span>
                    </CardFooter>
                  </Card>
                ))}
              {!tasks.some((t) => t.status === status) && (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无任务</p>
              )}
            </section>
          ))}
        </div>
      </div>
      {!data.tasks.length && (
        <Empty title="创建第一项工作" detail="明确主责人、协作成员和验收标准，再关联共同记忆。" />
      )}
      {create && <TaskForm {...props} initialNode={nodeFilter} onClose={() => setCreate(false)} />}{' '}
      {selectedCurrent && (
        <TaskDetail {...props} task={selectedCurrent} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
function TaskForm({
  data,
  members,
  api,
  run,
  busy,
  initialNode = '',
  task,
  onClose,
}: PageProps & { initialNode?: string; task?: Task; onClose: () => void }) {
  const [baseVersion] = useState(task?.version);
  const [form, setForm] = useState({
    nodeId: task?.nodeId || initialNode || data.nodes[0]?.id || '',
    title: task?.title || '',
    description: task?.description || '',
    ownerId: task?.ownerId || '',
    reviewerId: task?.reviewerId || '',
    collaboratorIds: task?.collaboratorIds || ([] as string[]),
    acceptanceCriteria: task?.acceptanceCriteria || '',
  });
  const node = data.nodes.find((n) => n.id === form.nodeId);
  const nodeMembers = members.filter(
    (m) => m.role === 'admin' || node?.memberIds.includes(m.id) || node?.ownerIds.includes(m.id),
  );
  const projectMembers = members.filter(
    (m) =>
      m.role === 'admin' ||
      data.nodes.some((n) => n.memberIds.includes(m.id) || n.ownerIds.includes(m.id)),
  );
  return (
    <Modal
      title={task ? '编辑任务与分工' : '新建工作项'}
      subtitle="明确任务目标、责任人与验收标准。"
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const { nodeId, ...editable } = form;
          const payload = task ? { ...editable, version: baseVersion } : form;
          const result = await run(
            () =>
              api<Task>(
                `/api/projects/${data.project.id}/tasks${task ? `/${task.id}` : ''}`,
                task ? 'PATCH' : 'POST',
                payload,
              ),
            task ? '任务与分工已更新' : '任务已创建',
          );
          if (result) onClose();
        }}
      >
        <FieldGroup>
          <Field label="任务名称">
            <Input
              required
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="所属节点">
            <AppSelect
              className="w-full"
              disabled={!!task}
              value={form.nodeId}
              onValueChange={(value) =>
                setForm({ ...form, nodeId: value, ownerId: '', collaboratorIds: [] })
              }
            >
              {data.nodes.map((n) => (
                <AppSelectOption key={n.id} value={n.id}>
                  {n.name}
                </AppSelectOption>
              ))}
            </AppSelect>
          </Field>
          <FieldGroup className="grid grid-cols-2 gap-4">
            <Field label="主责人">
              <MemberSelect
                members={nodeMembers}
                value={form.ownerId}
                onChange={(ownerId) => setForm({ ...form, ownerId })}
              />
            </Field>
            <Field label="验收人">
              <MemberSelect
                members={projectMembers}
                value={form.reviewerId}
                onChange={(reviewerId) => setForm({ ...form, reviewerId })}
              />
            </Field>
          </FieldGroup>
          <Field label="协作成员">
            <MemberChecks
              members={nodeMembers}
              values={form.collaboratorIds}
              onChange={(collaboratorIds) => setForm({ ...form, collaboratorIds })}
            />
          </Field>
          <Field label="工作说明">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="验收标准">
            <Textarea
              rows={3}
              value={form.acceptanceCriteria}
              onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })}
              placeholder="哪些结果可以证明这项工作已完成？"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              保存任务
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}
function TaskDetail(props: PageProps & { task: Task; onClose: () => void }) {
  const { task, data, members, me, api, run, busy, onClose, onDiscuss } = props;
  const [context, setContext] = useState<TaskContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [deliverable, setDeliverable] = useState(task.deliverable || '');
  const [editing, setEditing] = useState(false);
  const path = `/api/projects/${data.project.id}/tasks/${task.id}`;
  const node = data.nodes.find((n) => n.id === task.nodeId);
  const canAssign = me.role === 'admin' || !!node?.ownerIds.includes(me.id);
  const canWork = canAssign || task.ownerId === me.id || task.collaboratorIds?.includes(me.id);
  const canReview = me.role === 'admin' || me.id === task.reviewerId;
  useEffect(() => {
    let alive = true;
    api<TaskContext>(`${path}/context`)
      .then((r) => {
        if (alive) {
          setContext(r);
          setContextError('');
        }
      })
      .catch((e) => {
        if (alive) setContextError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api, path, task.version, data.memories]);
  const patch = (status: TaskStatus) =>
    run(() => api<Task>(path, 'PATCH', { version: task.version, status }), '任务状态已更新');
  if (editing) return <TaskForm {...props} task={task} onClose={() => setEditing(false)} />;
  return (
    <Modal
      title={task.title}
      subtitle={`${node?.name || ''} · 工作版本 v${task.version}`}
      onClose={onClose}
      wide
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={task.status === 'done' ? 'outline' : 'secondary'}>
            {statusNames[task.status]}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {memberName(members, task.ownerId)} 负责 · {memberName(members, task.reviewerId)} 验收
          </span>
          <div className="ml-auto flex gap-2">
            {onDiscuss && (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  onDiscuss({ kind: 'task', projectId: data.project.id, taskId: task.id });
                }}
              >
                <MessageSquare />
                讨论
              </Button>
            )}
            {canAssign && task.status !== 'done' && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                编辑分工
              </Button>
            )}
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">工作说明</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {task.description || '尚未填写'}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">验收标准</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {task.acceptanceCriteria || '尚未填写'}
          </p>
        </div>
        {task.collaboratorIds?.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <UsersRound className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">协作：</span>
            {task.collaboratorIds.map((id) => (
              <Badge variant="outline" key={id}>
                {memberName(members, id)}
              </Badge>
            ))}
          </div>
        )}
        <Separator />
        <div className="flex items-center justify-between">
          <h3 className="font-medium">共同记忆基线</h3>
          <Button
            variant="secondary"
            disabled={busy || task.status === 'done' || !canWork}
            onClick={() =>
              run(
                () => api<Task>(`${path}/sync`, 'POST', { version: task.version }),
                '已同步当前发布版本',
              )
            }
          >
            <RefreshCw />
            同步最新依据
          </Button>
        </div>
        {contextError && <Notice kind="error">{contextError}</Notice>}
        {context?.stale && (
          <Notice>工作依据已有变更。请阅读相关变化、同步基线，并调整成果后重新提交。</Notice>
        )}
        {context?.memories?.length ? (
          <div className="flex flex-col gap-2">
            {context.memories.map((m) => (
              <details key={m.id} className="rounded-lg border p-3">
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                  <span>{m.title}</span>
                  <Badge variant={task.memoryRefs?.[m.id] === m.version ? 'outline' : 'secondary'}>
                    依据 v{task.memoryRefs?.[m.id] || '—'} / 当前 v{m.version}
                  </Badge>
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {m.content}
                </p>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">暂无适用的已发布记忆。</p>
        )}
        <Separator />
        {task.status !== 'done' && canWork ? (
          <FieldGroup>
            <Field
              label="交付成果"
              hint="填写完成内容、验证结果和成果位置。平台会核对共同记忆版本。"
            >
              <Textarea
                rows={5}
                value={deliverable}
                onChange={(e) => setDeliverable(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                disabled={busy || !deliverable.trim()}
                onClick={() =>
                  run(
                    () =>
                      api<Task>(`${path}/submit`, 'POST', { version: task.version, deliverable }),
                    '成果已提交验收',
                  )
                }
              >
                <ArrowUpRight />
                提交成果
              </Button>
            </div>
          </FieldGroup>
        ) : task.deliverable ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">{task.status === 'done' ? '已验收成果' : '待验收成果'}</h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.deliverable}</p>
          </div>
        ) : null}
        <Separator />
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {canWork && (task.status === 'todo' || task.status === 'blocked') && (
              <Button variant="secondary" disabled={busy} onClick={() => patch('in_progress')}>
                开始工作
              </Button>
            )}
            {canWork && task.status === 'in_progress' && (
              <Button variant="secondary" disabled={busy} onClick={() => patch('blocked')}>
                标记阻塞
              </Button>
            )}
            {task.status === 'review' && canReview && (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => patch('in_progress')}>
                  退回调整
                </Button>
                <Button disabled={busy} onClick={() => patch('done')}>
                  <CheckCircle2 />
                  验收通过
                </Button>
              </>
            )}
          </div>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}
