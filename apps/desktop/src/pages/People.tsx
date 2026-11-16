import { useId, useState } from 'react';
import { ArrowRightLeft, Check, Copy, Settings2, UserRoundPlus } from 'lucide-react';
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
  CardAction,
} from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { memberName, formatTime } from '../types';
import type { Handover, Member, Node, PageProps } from '../types';

export default function People(props: PageProps) {
  const { data, members, me, api, run, busy } = props;
  const [create, setCreate] = useState(false);
  const [handover, setHandover] = useState(false);
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [deactivate, setDeactivate] = useState<Member | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [invite, setInvite] = useState<{ member: Member; token: string } | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="成员与责任交接"
        description="管理节点分工，移交未完成工作与项目资料。"
        actions={
          me.role === 'admin' ? (
            <>
              <Button variant="outline" onClick={() => setHandover(true)}>
                <ArrowRightLeft data-icon="inline-start" />
                责任移交
              </Button>
              <Button onClick={() => setCreate(true)}>
                <UserRoundPlus data-icon="inline-start" />
                开通成员
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>节点分工</CardTitle>
            <CardDescription>负责人和协作成员均支持多人。</CardDescription>
            <CardAction>
              <Badge variant="secondary">{data.nodes.length} 个节点</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>节点</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>协作成员</TableHead>
                  {me.role === 'admin' && (
                    <TableHead>
                      <span className="sr-only">操作</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell>
                      <span className="font-medium">{node.name}</span>
                    </TableCell>
                    <TableCell>
                      <NameList ids={node.ownerIds || []} members={members} />
                    </TableCell>
                    <TableCell>
                      <NameList ids={node.memberIds || []} members={members} />
                    </TableCell>
                    {me.role === 'admin' && (
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`调整${node.name}成员`}
                          onClick={() => setEditNode(node)}
                        >
                          <Settings2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>组织成员</CardTitle>
            <CardDescription>
              {members.filter((member) => member.active).length} 位有效成员
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {members.map((member, index) => (
                <div key={member.id} className="flex flex-col gap-4">
                  {index > 0 && <Separator />}
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{member.name.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{member.name}</span>
                        {member.id === me.id && <Badge variant="outline">我</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {member.role === 'admin' ? '管理员' : '协作成员'} ·{' '}
                        {member.active ? '已开通' : '已停用'}
                      </p>
                    </div>
                    {me.role === 'admin' && member.active && member.id !== me.id && (
                      <Button size="sm" variant="ghost" onClick={() => setDeactivate(member)}>
                        停用
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>责任移交记录</CardTitle>
          <CardDescription>保留历史提交与验收归属，分别记录责任变更和接手确认。</CardDescription>
        </CardHeader>
        <CardContent>
          {data.handovers.length ? (
            <div className="flex flex-col gap-5">
              {[...data.handovers].reverse().map((item, index) => (
                <div key={item.id} className="flex flex-col gap-4">
                  {index > 0 && <Separator />}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 font-medium">
                      <span>{memberName(members, item.fromMemberId)}</span>
                      <ArrowRightLeft aria-hidden="true" />
                      <span>{memberName(members, item.toMemberId)}</span>
                    </div>
                    <Badge variant={item.status === 'accepted' ? 'secondary' : 'outline'}>
                      {item.status === 'accepted' ? '已确认接手' : '等待接手确认'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.reason}</p>
                  <div className="flex flex-wrap gap-2">
                    {item.nodeIds.map((id) => (
                      <Badge key={id} variant="outline">
                        {data.nodes.find((node) => node.id === id)?.name || id}
                      </Badge>
                    ))}
                  </div>
                  <details className="rounded-lg border p-4">
                    <summary className="cursor-pointer text-sm font-medium">查看交接包</summary>
                    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                      {item.summary}
                    </p>
                  </details>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                      {formatTime(item.createdAt)}
                    </span>
                    {item.toMemberId === me.id && item.status === 'pending' && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              api<Handover>(
                                `/api/projects/${data.project.id}/handovers/${item.id}/accept`,
                                'POST',
                                {},
                              ),
                            '已确认接手',
                          )
                        }
                      >
                        <Check data-icon="inline-start" />
                        确认接手
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ArrowRightLeft />
                </EmptyMedia>
                <EmptyTitle>暂无责任移交</EmptyTitle>
                <EmptyDescription>负责人变更后，交接资料和接手状态会记录在这里。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
      {create && (
        <Modal
          title="开通成员"
          subtitle="创建独立的协同服务访问凭证。"
          onClose={() => setCreate(false)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run(
                () =>
                  api<{ member: Member; token: string }>('/api/members', 'POST', { name, role }),
                '成员已开通',
              );
              if (result) {
                setInvite(result);
                setCreate(false);
                setName('');
                setCopyState('idle');
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="member-name">成员姓名</FieldLabel>
                <Input
                  id="member-name"
                  required
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="请输入成员姓名"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="member-role">组织角色</FieldLabel>
                <NativeSelect
                  id="member-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as 'admin' | 'member')}
                >
                  <NativeSelectOption value="member">协作成员</NativeSelectOption>
                  <NativeSelectOption value="admin">管理员</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Alert>
                <AlertDescription>
                  将成员加入节点后即可访问对应项目。访问凭证仅在创建时展示一次。
                </AlertDescription>
              </Alert>
              <Field orientation="horizontal" className="justify-end">
                <Button type="button" variant="outline" onClick={() => setCreate(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={busy || !name.trim()}>
                  创建成员
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </Modal>
      )}
      {invite && (
        <Modal
          title={`${invite.member.name}的访问凭证`}
          subtitle="关闭后不会再次显示，请交给本人保管。"
          onClose={() => setInvite(null)}
        >
          <FieldGroup>
            <Alert>
              <AlertDescription>
                这是协同服务访问凭证，与模型供应商的 API Key 分开使用。
              </AlertDescription>
            </Alert>
            <Field>
              <FieldLabel htmlFor="invitation-token">成员访问凭证</FieldLabel>
              <Textarea
                id="invitation-token"
                readOnly
                rows={3}
                value={invite.token}
                onFocus={(event) => event.target.select()}
              />
            </Field>
            {copyState === 'failed' && (
              <p role="status" className="text-sm text-destructive">
                复制失败，请选中凭证手动复制。
              </p>
            )}
            <Field orientation="horizontal" className="justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invite.token);
                    setCopyState('copied');
                  } catch {
                    setCopyState('failed');
                  }
                }}
              >
                {copyState === 'copied' ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Copy data-icon="inline-start" />
                )}
                {copyState === 'copied' ? '已复制' : '复制凭证'}
              </Button>
              <Button
                onClick={() => {
                  setInvite(null);
                  setCopyState('idle');
                }}
              >
                已妥善保存
              </Button>
            </Field>
          </FieldGroup>
        </Modal>
      )}
      {editNode && <NodeEditor {...props} node={editNode} onClose={() => setEditNode(null)} />}
      {handover && <HandoverForm {...props} onClose={() => setHandover(false)} />}
      {deactivate && (
        <Modal title={`停用 ${deactivate.name}`} onClose={() => setDeactivate(null)}>
          <FieldGroup>
            <Alert>
              <AlertDescription>
                停用后访问凭证将失效。请先完成未结束工作的责任移交，历史记录会保留。
              </AlertDescription>
            </Alert>
            <Field orientation="horizontal" className="justify-end">
              <Button variant="outline" onClick={() => setDeactivate(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  const result = await run(
                    () => api<Member>(`/api/members/${deactivate.id}/deactivate`, 'POST', {}),
                    '成员已停用',
                  );
                  if (result) setDeactivate(null);
                }}
              >
                确认停用
              </Button>
            </Field>
          </FieldGroup>
        </Modal>
      )}
    </div>
  );
}

function NameList({ ids, members }: { ids: string[]; members: Member[] }) {
  return ids.length ? (
    <div className="flex max-w-60 flex-wrap gap-1.5">
      {ids.map((id) => (
        <Badge key={id} variant="secondary">
          {memberName(members, id)}
        </Badge>
      ))}
    </div>
  ) : (
    <span className="text-muted-foreground">未分配</span>
  );
}
function MemberChoices({
  members,
  values,
  onChange,
  legend,
}: {
  members: Member[];
  values: string[];
  onChange: (ids: string[]) => void;
  legend: string;
}) {
  const prefix = useId();
  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldGroup className="grid grid-cols-2 gap-3">
        {members
          .filter((member) => member.active)
          .map((member) => (
            <Field key={member.id} orientation="horizontal">
              <Checkbox
                id={`${prefix}-${member.id}`}
                checked={values.includes(member.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...new Set([...values, member.id])]
                      : values.filter((id) => id !== member.id),
                  )
                }
              />
              <FieldLabel htmlFor={`${prefix}-${member.id}`}>{member.name}</FieldLabel>
            </Field>
          ))}
      </FieldGroup>
    </FieldSet>
  );
}
function NodeEditor({
  node,
  data,
  members,
  api,
  run,
  busy,
  onClose,
}: PageProps & { node: Node; onClose: () => void }) {
  const [owners, setOwners] = useState(node.ownerIds || []);
  const [participants, setParticipants] = useState(node.memberIds || []);
  return (
    <Modal
      title={`调整分工 · ${node.name}`}
      subtitle="负责人会自动加入节点成员。"
      onClose={onClose}
    >
      <FieldGroup>
        <MemberChoices members={members} values={owners} onChange={setOwners} legend="节点负责人" />
        <MemberChoices
          members={members}
          values={participants}
          onChange={setParticipants}
          legend="协作成员"
        />
        <Field orientation="horizontal" className="justify-end">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const result = await run(
                () =>
                  api<Node>(`/api/projects/${data.project.id}/nodes/${node.id}`, 'PATCH', {
                    ownerIds: owners,
                    memberIds: [...new Set([...participants, ...owners])],
                  }),
                '节点分工已更新',
              );
              if (result) onClose();
            }}
          >
            保存分工
          </Button>
        </Field>
      </FieldGroup>
    </Modal>
  );
}
function HandoverForm({
  data,
  members,
  api,
  run,
  busy,
  onClose,
}: PageProps & { onClose: () => void }) {
  const [fromMemberId, setFrom] = useState('');
  const [toMemberId, setTo] = useState('');
  const [nodeIds, setNodes] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const eligibleNodes = data.nodes.filter(
    (node) =>
      !fromMemberId ||
      node.memberIds.includes(fromMemberId) ||
      node.ownerIds.includes(fromMemberId) ||
      data.tasks.some(
        (task) =>
          task.nodeId === node.id &&
          task.status !== 'done' &&
          (task.ownerId === fromMemberId ||
            task.reviewerId === fromMemberId ||
            task.collaboratorIds.includes(fromMemberId)),
      ) ||
      data.issues.some(
        (issue) =>
          issue.nodeId === node.id &&
          issue.status !== 'resolved' &&
          issue.assigneeId === fromMemberId,
      ),
  );
  return (
    <Modal
      title="发起责任移交"
      subtitle="转交所选节点内的未完成工作与待处理问题。"
      onClose={onClose}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await run(
            () =>
              api<Handover>(`/api/projects/${data.project.id}/handovers`, 'POST', {
                fromMemberId,
                toMemberId,
                nodeIds,
                reason,
              }),
            '责任已移交，等待接手人确认',
          );
          if (result) onClose();
        }}
      >
        <FieldGroup>
          <FieldGroup className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="handover-from">原负责人</FieldLabel>
              <NativeSelect
                id="handover-from"
                value={fromMemberId}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setNodes([]);
                  if (event.target.value === toMemberId) setTo('');
                }}
              >
                <NativeSelectOption value="">选择成员</NativeSelectOption>
                {members
                  .filter((member) => member.active)
                  .map((member) => (
                    <NativeSelectOption key={member.id} value={member.id}>
                      {member.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="handover-to">新负责人</FieldLabel>
              <NativeSelect
                id="handover-to"
                value={toMemberId}
                onChange={(event) => setTo(event.target.value)}
              >
                <NativeSelectOption value="">选择成员</NativeSelectOption>
                {members
                  .filter((member) => member.active && member.id !== fromMemberId)
                  .map((member) => (
                    <NativeSelectOption key={member.id} value={member.id}>
                      {member.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <FieldSet>
            <FieldLegend variant="label">移交节点</FieldLegend>
            <FieldDescription>仅显示原负责人参与或仍有未完成责任的节点。</FieldDescription>
            <FieldGroup className="grid grid-cols-2 gap-3">
              {eligibleNodes.map((node) => (
                <Field key={node.id} orientation="horizontal">
                  <Checkbox
                    id={`handover-node-${node.id}`}
                    checked={nodeIds.includes(node.id)}
                    onCheckedChange={(checked) =>
                      setNodes(
                        checked === true
                          ? [...nodeIds, node.id]
                          : nodeIds.filter((id) => id !== node.id),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`handover-node-${node.id}`}>{node.name}</FieldLabel>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          <Field>
            <FieldLabel htmlFor="handover-reason">变更原因</FieldLabel>
            <Textarea
              id="handover-reason"
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：岗位调整、人员离职或临时接替"
            />
          </Field>
          <Alert>
            <AlertDescription>已完成任务、原始提交人和历史验收归属保持原记录。</AlertDescription>
          </Alert>
          <Field orientation="horizontal" className="justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !fromMemberId ||
                !toMemberId ||
                !nodeIds.length ||
                !reason.trim() ||
                fromMemberId === toMemberId
              }
            >
              确认移交
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </Modal>
  );
}
