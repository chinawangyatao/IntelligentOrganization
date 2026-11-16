import { useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  GitBranch,
  History,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Modal, PageHeader } from '../components';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Textarea } from '@/components/ui/textarea';
import { AppSelect, AppSelectOption } from '@/components/AppSelect';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { memoryKinds, memberName, formatTime } from '../types';
import type { PageProps, Memory as MemoryEntry, MemoryKind } from '../types';

const memoryStatuses = { draft: '待确认草稿', published: '已发布', superseded: '已废弃' };
export default function Memory(props: PageProps) {
  const { data, members, api, run, busy } = props;
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [edit, setEdit] = useState<MemoryEntry | null | undefined>(undefined);
  const [history, setHistory] = useState<MemoryEntry[] | null>(null);
  const items = data.memories.filter(
    (memory) =>
      (kind === 'all' || memory.kind === kind) &&
      (!query || `${memory.title} ${memory.content}`.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="共享记忆"
        description="管理有版本的需求、接口约定、项目决策与经验。"
        actions={
          <Button onClick={() => setEdit(null)}>
            <Plus data-icon="inline-start" />
            新增记忆
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={kind} onValueChange={setKind}>
          <TabsList>
            <TabsTrigger value="all">全部 · {data.memories.length}</TabsTrigger>
            {Object.entries(memoryKinds).map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索共享记忆"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题或内容"
          />
        </InputGroup>
      </div>
      {items.length ? (
        <div className="grid items-stretch gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map((memory) => (
            <Card key={memory.id}>
              <CardHeader>
                <CardTitle>{memory.title}</CardTitle>
                <CardDescription>
                  {memoryKinds[memory.kind]} ·{' '}
                  {memory.nodeId
                    ? data.nodes.find((node) => node.id === memory.nodeId)?.name
                    : '项目通用'}
                </CardDescription>
                <CardAction>
                  <Badge
                    variant={
                      memory.status === 'published'
                        ? 'default'
                        : memory.status === 'draft'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {memoryStatuses[memory.status]}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                  {memory.content}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Badge variant="outline">v{memory.version}</Badge>
                  {memory.sourceMemoryId && (
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <GitBranch aria-hidden="true" />
                      复用来源 v{memory.sourceVersion}
                    </span>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex-wrap justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar size="sm">
                    <AvatarFallback>
                      {memberName(members, memory.updatedBy).slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm">
                      {memberName(members, memory.updatedBy)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatTime(memory.updatedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`查看${memory.title}的历史版本`}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await api<MemoryEntry[]>(
                          `/api/projects/${data.project.id}/memories/${memory.id}/history`,
                        );
                        setHistory(result);
                        return result;
                      })
                    }
                  >
                    <History />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEdit(memory)}>
                    查看
                    <ArrowUpRight data-icon="inline-end" />
                  </Button>
                </div>
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
                  <BookOpen />
                </EmptyMedia>
                <EmptyTitle>
                  {query || kind !== 'all' ? '没有匹配的记忆' : '暂无共享记忆'}
                </EmptyTitle>
                <EmptyDescription>
                  {query || kind !== 'all'
                    ? '尝试其他关键词或记忆类型。'
                    : '新增草稿，或发布经过确认的需求与决策。'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setEdit(null)}>
                  <Plus data-icon="inline-start" />
                  新增记忆
                </Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      )}
      {edit !== undefined && (
        <MemoryEditor {...props} entry={edit} onClose={() => setEdit(undefined)} />
      )}
      {history && (
        <Modal
          title="记忆版本历史"
          subtitle="保留原始内容、修改人和更新时间。"
          onClose={() => setHistory(null)}
          wide
        >
          <div className="flex flex-col gap-5">
            {history.map((memory, index) => (
              <div key={`${memory.id}-${memory.version}-${index}`} className="flex flex-col gap-4">
                {index > 0 && <Separator />}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-medium">{memory.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {memberName(members, memory.updatedBy)} · {formatTime(memory.updatedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">v{memory.version}</Badge>
                    <Badge variant="secondary">{memoryStatuses[memory.status]}</Badge>
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-7">
                  {memory.content}
                </p>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function MemoryEditor({
  entry,
  data,
  me,
  api,
  run,
  busy,
  onClose,
}: PageProps & { entry: MemoryEntry | null; onClose: () => void }) {
  const [form, setForm] = useState({
    title: entry?.title || '',
    content: entry?.content || '',
    nodeId: entry?.nodeId || '',
    kind: entry?.kind || ('requirement' as MemoryKind),
    status: entry?.status || 'draft',
  });
  const canPublish =
    me.role === 'admin' ||
    data.nodes.some((node) => node.id === form.nodeId && node.ownerIds.includes(me.id));
  const canEdit = canPublish || !entry || (entry.status === 'draft' && entry.updatedBy === me.id);
  const save = async (status: string) => {
    const payload = entry
      ? { title: form.title, content: form.content, status, version: entry.version }
      : { ...form, nodeId: form.nodeId || undefined, status };
    const result = await run(
      () =>
        api<MemoryEntry>(
          `/api/projects/${data.project.id}/memories${entry ? `/${entry.id}` : ''}`,
          entry ? 'PATCH' : 'POST',
          payload,
        ),
      status === 'published' ? '共同记忆已发布' : '记忆已保存',
    );
    if (result) onClose();
  };
  return (
    <Modal
      title={entry ? '共同记忆详情' : '新增共同记忆'}
      subtitle={
        entry
          ? `当前版本 v${entry.version} · 修改后保留历史版本`
          : '先保存草稿，再由负责人确认发布。'
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(form.status);
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="memory-title">标题</FieldLabel>
            <Input
              id="memory-title"
              required
              autoFocus
              readOnly={!canEdit}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="例如：订单取消业务规则"
            />
          </Field>
          <FieldGroup className="grid grid-cols-2 gap-4">
            <Field data-disabled={!!entry}>
              <FieldLabel htmlFor="memory-kind">记忆类型</FieldLabel>
              <AppSelect
                id="memory-kind"
                disabled={!!entry}
                value={form.kind}
                onValueChange={(value) => setForm({ ...form, kind: value as MemoryKind })}
              >
                {Object.entries(memoryKinds).map(([key, label]) => (
                  <AppSelectOption key={key} value={key}>
                    {label}
                  </AppSelectOption>
                ))}
              </AppSelect>
            </Field>
            <Field data-disabled={!!entry}>
              <FieldLabel htmlFor="memory-scope">适用范围</FieldLabel>
              <AppSelect
                id="memory-scope"
                disabled={!!entry}
                value={form.nodeId}
                onValueChange={(value) => setForm({ ...form, nodeId: value })}
              >
                <AppSelectOption value="">项目通用</AppSelectOption>
                {data.nodes.map((node) => (
                  <AppSelectOption key={node.id} value={node.id}>
                    {node.name}
                  </AppSelectOption>
                ))}
              </AppSelect>
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="memory-content">内容与依据</FieldLabel>
            <Textarea
              id="memory-content"
              required
              readOnly={!canEdit}
              rows={10}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              placeholder="业务规则、接口结构、采用原因与来源"
            />
            <FieldDescription>
              记录结论、适用条件和来源，未经确认的内容保留为草稿。
            </FieldDescription>
          </Field>
          {entry?.sourceMemoryId && (
            <Alert>
              <GitBranch />
              <AlertDescription>
                复用自历史成果 v{entry.sourceVersion}，请根据当前需求差异重新确认。
              </AlertDescription>
            </Alert>
          )}
          {!canEdit && (
            <Alert>
              <FileText />
              <AlertDescription>
                你可以阅读此记忆。修改正式内容需要管理员或对应节点负责人操作。
              </AlertDescription>
            </Alert>
          )}
          <Field orientation="horizontal" className="flex-wrap justify-between gap-3">
            <div>
              {entry && entry.status !== 'superseded' && canPublish && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => save('superseded')}
                >
                  标记为已废弃
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {canEdit ? '取消' : '关闭'}
              </Button>
              {canEdit && (
                <Button type="submit" disabled={busy || !form.title.trim() || !form.content.trim()}>
                  {form.status === 'published'
                    ? '保存新版本'
                    : form.status === 'draft'
                      ? '保存草稿'
                      : '保存修改'}
                </Button>
              )}
              {canPublish && form.status !== 'published' && (
                <Button
                  type="button"
                  disabled={busy || !form.title.trim() || !form.content.trim()}
                  onClick={() => save('published')}
                >
                  <ShieldCheck data-icon="inline-start" />
                  确认发布
                </Button>
              )}
            </div>
          </Field>
        </FieldGroup>
      </form>
    </Modal>
  );
}
