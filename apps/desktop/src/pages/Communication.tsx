import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Send,
  MessageSquare,
  Hash,
  UsersRound,
  AtSign,
  BookMarked,
  LockKeyhole,
  CheckCheck,
  ChevronUp,
} from 'lucide-react';
import {
  Button,
  Empty,
  Field,
  MemberChecks,
  Modal,
  Notice,
  PageHeader,
  PersonAvatar,
} from '../components';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
} from '@/components/ui/input-group';
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScrollerVisibility,
} from '@/components/ui/message-scroller';
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
  MessageFooter,
} from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { memberName, formatTime, memoryKinds } from '../types';
import type {
  Conversation,
  ConversationScope,
  Memory,
  MemoryKind,
  Message as ChatMessage,
  PageProps,
} from '../types';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { cn } from '@/lib/utils';
const kindLabel = {
  project: '项目',
  node: '节点',
  task: '任务',
  issue: '问题',
  direct: '私聊',
  group: '小群',
};
export default function Communication(
  props: PageProps & { requestedScope: ConversationScope | null; onScopeOpened: () => void },
) {
  const { data, members, me, api, requestedScope, onScopeOpened } = props;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [promoting, setPromoting] = useState<ChatMessage | null>(null);
  const load = useCallback(async () => {
    const items = await api<Conversation[]>('/api/conversations');
    setConversations(items || []);
    setError('');
    return items || [];
  }, [api]);
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      if (document.hidden) return;
      try {
        const items = await api<Conversation[]>('/api/conversations');
        if (alive) {
          setConversations(items || []);
          setError('');
          setSelectedId(
            (current) =>
              current ||
              (items || []).find((c) => c.projectId === data.project.id && c.kind === 'project')
                ?.id ||
              (items || []).find((c) => ['direct', 'group'].includes(c.kind))?.id ||
              '',
          );
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '会话列表同步失败');
      }
    };
    void sync();
    const timer = setInterval(sync, 3000);
    const visible = () => {
      if (!document.hidden) void sync();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [api, data.project.id]);
  useEffect(() => {
    if (!requestedScope) return;
    let alive = true;
    api<Conversation>('/api/conversations', 'POST', requestedScope)
      .then(async (c) => {
        await load();
        if (alive) {
          setSelectedId(c.id);
          onScopeOpened();
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [requestedScope, api, load, onScopeOpened]);
  const visible = conversations.filter(
    (c) => c.projectId === data.project.id || ['direct', 'group'].includes(c.kind),
  );
  const selected = visible.find((c) => c.id === selectedId);
  const title = (c: Conversation) =>
    c.kind === 'direct'
      ? c.participantIds
          .filter((id) => id !== me.id)
          .map((id) => memberName(members, id))
          .join('、')
      : c.name || `${kindLabel[c.kind]}讨论`;
  return (
    <>
      <PageHeader
        title="团队通信"
        description="项目频道、关联讨论与成员私聊。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            发起会话
          </Button>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid h-[calc(100vh-15rem)] min-h-[560px] min-w-0 grid-cols-[230px_minmax(0,1fr)] overflow-hidden rounded-xl border xl:grid-cols-[240px_minmax(0,1fr)_220px]">
        <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto border-r bg-muted/20 p-3">
          <p className="px-2 py-2 text-xs font-medium text-muted-foreground">当前项目频道</p>
          {visible
            .filter((c) => !['direct', 'group'].includes(c.kind))
            .map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                name={title(c)}
                selected={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
                members={members}
              />
            ))}
          <Separator className="my-3" />
          <p className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
            <LockKeyhole className="size-3.5" />
            私聊与小群
          </p>
          {visible
            .filter((c) => ['direct', 'group'].includes(c.kind))
            .map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                name={title(c)}
                selected={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
                members={members}
              />
            ))}
          {!visible.length && (
            <p className="px-2 py-4 text-sm text-muted-foreground">暂无可见会话</p>
          )}
        </aside>
        {selected ? (
          <ConversationThread
            key={selected.id}
            {...props}
            conversation={selected}
            name={title(selected)}
            onChange={load}
            onPromote={(message) => setPromoting(message)}
          />
        ) : (
          <Empty
            title="选择一个会话"
            detail="项目频道向项目成员开放，私聊与小群仅参与者可见。"
            action={<Button onClick={() => setCreating(true)}>发起会话</Button>}
          />
        )}
        <aside className="hidden overflow-y-auto border-l bg-muted/10 p-4 xl:flex xl:flex-col xl:gap-5">
          {selected ? (
            <>
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">会话信息</h3>
                <Badge variant="outline" className="w-fit">
                  {kindLabel[selected.kind]}
                </Badge>
                <p className="break-words text-sm text-muted-foreground">{title(selected)}</p>
              </div>
              <Separator />
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium">
                  {['direct', 'group'].includes(selected.kind) ? '参与成员' : '访问范围'}
                </h3>
                {['direct', 'group'].includes(selected.kind) ? (
                  selected.participantIds.map((id) => (
                    <div className="flex items-center gap-2" key={id}>
                      <PersonAvatar name={memberName(members, id)} size="sm" />
                      <span className="text-sm">{memberName(members, id)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    拥有该项目权限的成员可以查看此频道。
                  </p>
                )}
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">共享记忆</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  本人消息可以主动提取为记忆草稿，审核发布后再成为工作依据。
                </p>
                {['direct', 'group'].includes(selected.kind) && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    私人消息不会自动进入项目上下文。
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">选择会话后查看参与成员和关联信息。</p>
          )}
        </aside>
      </div>
      {creating && (
        <ConversationForm
          {...props}
          onClose={() => setCreating(false)}
          onCreated={async (c) => {
            await load();
            setSelectedId(c.id);
            setCreating(false);
          }}
        />
      )}
      {promoting && (
        <PromoteForm
          {...props}
          message={promoting}
          privateScope={selected?.kind === 'direct' || selected?.kind === 'group'}
          onClose={() => setPromoting(null)}
          onPromoted={async () => {
            await load();
          }}
        />
      )}
    </>
  );
}
function ConversationItem({
  conversation: c,
  name,
  selected,
  onClick,
  members,
}: {
  conversation: Conversation;
  name: string;
  selected: boolean;
  onClick: () => void;
  members: PageProps['members'];
}) {
  return (
    <button
      className={cn(
        'flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent',
        selected && 'bg-accent',
      )}
      onClick={onClick}
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
        {c.kind === 'direct' ? (
          <PersonAvatar name={name} size="sm" />
        ) : c.kind === 'group' ? (
          <UsersRound className="size-4" />
        ) : (
          <Hash className="size-4" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {c.lastMessage
            ? `${memberName(members, c.lastMessage.senderId)}：${c.lastMessage.body}`
            : '暂无消息'}
        </span>
      </div>
      {c.unreadCount > 0 && <Badge>{c.unreadCount > 99 ? '99+' : c.unreadCount}</Badge>}
    </button>
  );
}
function ConversationThread({
  conversation,
  name,
  onChange,
  onPromote,
  ...props
}: PageProps & {
  conversation: Conversation;
  name: string;
  onChange: () => Promise<unknown>;
  onPromote: (m: ChatMessage) => void;
}) {
  const { data, members, me, api } = props;
  const chat = useConversationMessages(api, conversation.id, onChange);
  const [body, setBody] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const draftRevision = useRef(0);
  const projectMembers = new Set(data.nodes.flatMap((n) => [...n.memberIds, ...n.ownerIds]));
  const mentionMembers = members.filter(
    (m) =>
      m.active &&
      m.id !== me.id &&
      (['direct', 'group'].includes(conversation.kind)
        ? conversation.participantIds.includes(m.id)
        : projectMembers.has(m.id) || m.role === 'admin'),
  );
  const send = async () => {
    const revision = draftRevision.current;
    if ((await chat.send(body, mentionIds)) && revision === draftRevision.current) {
      setBody('');
      setMentionIds([]);
      setShowMentions(false);
    }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate font-semibold">{name}</h2>
          <p className="text-xs text-muted-foreground">
            {chat.paused
              ? '后台已暂停同步'
              : chat.syncing
                ? '正在同步…'
                : `每 3 秒同步${chat.lastSynced ? ` · ${formatTime(chat.lastSynced)}` : ''}`}
          </p>
        </div>
        <Badge variant="outline">{kindLabel[conversation.kind]}</Badge>
      </header>
      {chat.error && (
        <div className="px-4 pt-3">
          <Notice kind="error">{chat.error}</Notice>
        </div>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport preserveScrollOnPrepend>
            <MessageScrollerContent className="p-5">
              {chat.hasMore && (
                <MessageScrollerItem messageId="older-control">
                  <div className="flex justify-center">
                    <Button
                      variant="ghost"
                      disabled={chat.loadingOlder || chat.syncing}
                      onClick={chat.older}
                    >
                      <ChevronUp />
                      {chat.loadingOlder ? '加载中…' : '加载更早消息'}
                    </Button>
                  </div>
                </MessageScrollerItem>
              )}
              {chat.loading ? (
                <MessageScrollerItem messageId="loading">
                  <Skeleton className="h-20 w-2/3" />
                </MessageScrollerItem>
              ) : !chat.messages.length ? (
                <MessageScrollerItem messageId="empty">
                  <Empty title="暂无消息" detail="可以在这里讨论工作、补充依据或反馈问题。" />
                </MessageScrollerItem>
              ) : (
                chat.messages.map((m, i) => (
                  <MessageScrollerItem key={m.id} messageId={m.id}>
                    <Message align={m.senderId === me.id ? 'end' : 'start'}>
                      <MessageAvatar>
                        <PersonAvatar name={memberName(members, m.senderId)} />
                      </MessageAvatar>
                      <MessageContent>
                        <MessageHeader>
                          {memberName(members, m.senderId)} · {formatTime(m.createdAt)}
                        </MessageHeader>
                        <Bubble
                          variant={m.senderId === me.id ? 'default' : 'secondary'}
                          align={m.senderId === me.id ? 'end' : 'start'}
                        >
                          <BubbleContent>
                            <div className="whitespace-pre-wrap break-words">
                              {m.mentionIds?.length > 0 && (
                                <div className="mb-1 font-medium">
                                  {m.mentionIds
                                    .map((id) => `@${memberName(members, id)}`)
                                    .join(' ')}
                                </div>
                              )}
                              {m.body}
                            </div>
                          </BubbleContent>
                        </Bubble>
                        <MessageFooter className="gap-3">
                          {m.promotedMemoryId ? (
                            <span className="flex items-center gap-1">
                              <BookMarked className="size-3" />
                              已提取草稿
                            </span>
                          ) : (
                            m.senderId === me.id &&
                            data.project.id && (
                              <button
                                className="flex items-center gap-1 hover:underline"
                                onClick={() => onPromote(m)}
                              >
                                <BookMarked className="size-3" />
                                提取记忆草稿
                              </button>
                            )
                          )}
                          {m.senderId === me.id &&
                            chat.receipts.filter(
                              (r) =>
                                r.memberId !== me.id &&
                                chat.messages.findIndex((message) => message.id === r.messageId) >=
                                  i,
                            ).length > 0 && (
                              <span className="flex items-center gap-1">
                                <CheckCheck className="size-3" />
                                {
                                  chat.receipts.filter(
                                    (r) =>
                                      r.memberId !== me.id &&
                                      chat.messages.findIndex(
                                        (message) => message.id === r.messageId,
                                      ) >= i,
                                  ).length
                                }{' '}
                                人已读
                              </span>
                            )}
                        </MessageFooter>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ))
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
          <ReadVisible
            latestId={chat.messages.at(-1)?.id}
            ready={
              !chat.loading &&
              !chat.syncing &&
              !chat.paused &&
              !chat.sending &&
              chat.coverageComplete
            }
            markRead={chat.read}
          />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="flex shrink-0 flex-col gap-3 border-t p-4">
        {showMentions && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>提醒成员</CardTitle>
              <CardDescription>提及仅限当前会话可访问成员。</CardDescription>
            </CardHeader>
            <CardContent>
              <MemberChecks
                members={mentionMembers}
                values={mentionIds}
                onChange={(value) => {
                  draftRevision.current++;
                  setMentionIds(value);
                }}
              />
            </CardContent>
          </Card>
        )}
        {mentionIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {mentionIds.map((id) => (
              <Badge key={id} variant="secondary">
                @{memberName(members, id)}
              </Badge>
            ))}
          </div>
        )}
        <InputGroup>
          <InputGroupTextarea
            value={body}
            maxLength={12000}
            rows={3}
            placeholder="输入消息，Enter 发送，Shift + Enter 换行"
            onChange={(e) => {
              draftRevision.current++;
              setBody(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton variant="ghost" onClick={() => setShowMentions(!showMentions)}>
              <AtSign data-icon="inline-start" />
              提及
            </InputGroupButton>
            <InputGroupText className="ml-auto">{body.length}/12000</InputGroupText>
            <InputGroupButton
              variant="default"
              disabled={chat.sending || !chat.coverageComplete || !body.trim()}
              onClick={send}
            >
              <Send data-icon="inline-start" />
              {chat.sending ? '发送中…' : '发送'}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
function ReadVisible({
  latestId,
  ready,
  markRead,
}: {
  latestId?: string;
  ready: boolean;
  markRead: (id: string) => Promise<void>;
}) {
  const visibility = useMessageScrollerVisibility();
  useEffect(() => {
    if (ready && latestId && visibility.visibleMessageIds.includes(latestId))
      void markRead(latestId);
  }, [ready, latestId, visibility.visibleMessageIds, markRead]);
  return null;
}
function ConversationForm({
  data,
  members,
  me,
  api,
  onClose,
  onCreated,
}: PageProps & { onClose: () => void; onCreated: (c: Conversation) => Promise<void> }) {
  const [kind, setKind] = useState<ConversationScope['kind']>('direct');
  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload: ConversationScope = { kind };
      if (['project', 'node', 'task', 'issue'].includes(kind)) payload.projectId = data.project.id;
      if (kind === 'node') payload.nodeId = scope;
      if (kind === 'task') payload.taskId = scope;
      if (kind === 'issue') payload.issueId = scope;
      if (kind === 'group') payload.name = name;
      if (['direct', 'group'].includes(kind)) payload.participantIds = participants;
      await onCreated(await api<Conversation>('/api/conversations', 'POST', payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : '会话创建失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="发起会话" subtitle="选择公开讨论范围，或联系组织成员。" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FieldGroup>
          {error && <Notice kind="error">{error}</Notice>}
          <Field label="会话类型">
            <NativeSelect
              className="w-full"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setScope('');
                setParticipants([]);
              }}
            >
              {Object.entries(kindLabel)
                .filter(([key]) => data.project.id || ['direct', 'group'].includes(key))
                .map(([key, label]) => (
                  <NativeSelectOption key={key} value={key}>
                    {label}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          {kind === 'group' && (
            <Field label="小群名称">
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          {['node', 'task', 'issue'].includes(kind) && (
            <Field
              label={kind === 'node' ? '关联节点' : kind === 'task' ? '关联工作项' : '关联问题'}
            >
              <NativeSelect
                className="w-full"
                required
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <NativeSelectOption value="">请选择</NativeSelectOption>
                {(kind === 'node'
                  ? data.nodes.map((n) => ({ id: n.id, title: n.name }))
                  : kind === 'task'
                    ? data.tasks
                    : data.issues
                ).map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          {kind === 'direct' && (
            <Field label="联系成员">
              <NativeSelect
                className="w-full"
                required
                value={participants[0] || ''}
                onChange={(e) => setParticipants(e.target.value ? [e.target.value] : [])}
              >
                <NativeSelectOption value="">选择成员</NativeSelectOption>
                {members
                  .filter((m) => m.active && m.id !== me.id)
                  .map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
          )}
          {kind === 'group' && (
            <Field label="邀请成员">
              <MemberChecks
                members={members.filter((m) => m.id !== me.id)}
                values={participants}
                onChange={setParticipants}
              />
            </Field>
          )}
          {['direct', 'group'].includes(kind) && (
            <Notice>私聊和小群仅参与者可见，消息不会自动进入项目共同记忆。</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || (['direct', 'group'].includes(kind) && !participants.length)}
            >
              {busy ? '创建中…' : '打开会话'}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}
function PromoteForm({
  message,
  privateScope,
  data,
  api,
  run,
  busy,
  onClose,
  onPromoted,
}: PageProps & {
  message: ChatMessage;
  privateScope?: boolean;
  onClose: () => void;
  onPromoted: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<MemoryKind>('decision');
  const [nodeId, setNodeId] = useState('');
  return (
    <Modal
      title="提取为记忆草稿"
      subtitle="保留消息来源，由负责人审核发布后成为共同依据。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await run(
            () =>
              api<Memory>(
                `/api/conversations/${message.conversationId}/messages/${message.id}/promote`,
                'POST',
                { projectId: data.project.id, nodeId: nodeId || undefined, title, kind },
              ),
            '已提取为记忆草稿',
          );
          if (result) {
            await onPromoted();
            onClose();
          }
        }}
      >
        <FieldGroup>
          {privateScope && (
            <Notice>
              你正在主动将本人的私人消息复制到当前项目。提取后，项目成员可以查看此记忆草稿。
            </Notice>
          )}
          <blockquote className="max-h-40 overflow-auto rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </blockquote>
          <Field label="记忆标题">
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <FieldGroup className="grid grid-cols-2 gap-4">
            <Field label="记忆类型">
              <NativeSelect
                className="w-full"
                value={kind}
                onChange={(e) => setKind(e.target.value as MemoryKind)}
              >
                {Object.entries(memoryKinds).map(([key, label]) => (
                  <NativeSelectOption key={key} value={key}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label="适用范围">
              <NativeSelect
                className="w-full"
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
              >
                <NativeSelectOption value="">项目通用</NativeSelectOption>
                {data.nodes.map((n) => (
                  <NativeSelectOption key={n.id} value={n.id}>
                    {n.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              确认提取草稿
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}
