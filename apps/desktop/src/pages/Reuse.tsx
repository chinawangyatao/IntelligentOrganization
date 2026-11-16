import { useState } from 'react';
import { CopyPlus, GitBranch, Layers3, FileCheck2, UsersRound } from 'lucide-react';
import { PageHeader } from '../components';
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
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
  FieldContent,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { memoryKinds } from '../types';
import type { PageProps, Project } from '../types';

export default function Reuse({
  data,
  me,
  api,
  run,
  busy,
  onProjectCreated,
}: PageProps & { onProjectCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>(
    data.memories.filter((memory) => memory.status === 'published').map((memory) => memory.id),
  );
  const isAdmin = me.role === 'admin';
  const submit = async () => {
    const result = await run(
      () =>
        api<Project>(`/api/projects/${data.project.id}/reuse`, 'POST', {
          name,
          description,
          memoryIds: selected,
        }),
      '新项目已创建，请分配成员并确认需求差异',
    );
    if (result) onProjectCreated(result.id);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="经验复用" description="选择已有流程和记忆，为新项目建立独立的工作基线。" />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>从当前项目创建</CardTitle>
            <CardDescription>来源项目：{data.project.name}</CardDescription>
            <CardAction>
              <Badge variant="outline">{data.nodes.length} 个节点</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <form
              id="reuse-project-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <FieldGroup>
                {!isAdmin && (
                  <Alert>
                    <AlertDescription>
                      你可以查看可复用内容，创建新项目需要管理员操作。
                    </AlertDescription>
                  </Alert>
                )}
                <Field data-disabled={!isAdmin}>
                  <FieldLabel htmlFor="reuse-name">新项目名称</FieldLabel>
                  <Input
                    id="reuse-name"
                    required
                    disabled={!isAdmin}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="例如：企业采购协同系统"
                  />
                </Field>
                <Field data-disabled={!isAdmin}>
                  <FieldLabel htmlFor="reuse-description">新需求与差异</FieldLabel>
                  <Textarea
                    id="reuse-description"
                    required
                    disabled={!isAdmin}
                    rows={5}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="项目目标、需要调整的功能、待确认规则，以及新增内容"
                  />
                  <FieldDescription>
                    这些差异将作为新项目的需求概述，由负责人继续确认。
                  </FieldDescription>
                </Field>
                <FieldSet disabled={!isAdmin}>
                  <FieldLegend variant="label">选择引入的共同记忆</FieldLegend>
                  <FieldDescription>选定内容会复制为草稿，并保留来源版本。</FieldDescription>
                  {data.memories.length ? (
                    <FieldGroup className="max-h-[420px] overflow-y-auto pr-2">
                      {data.memories.map((memory) => (
                        <Field key={memory.id} orientation="horizontal" data-disabled={!isAdmin}>
                          <Checkbox
                            id={`reuse-memory-${memory.id}`}
                            disabled={!isAdmin}
                            checked={selected.includes(memory.id)}
                            onCheckedChange={(checked) =>
                              setSelected(
                                checked === true
                                  ? [...new Set([...selected, memory.id])]
                                  : selected.filter((id) => id !== memory.id),
                              )
                            }
                          />
                          <FieldContent>
                            <FieldLabel htmlFor={`reuse-memory-${memory.id}`}>
                              {memory.title}
                            </FieldLabel>
                            <FieldDescription>
                              {memoryKinds[memory.kind]} · 来源 v{memory.version} ·{' '}
                              {memory.status === 'published'
                                ? '已发布'
                                : memory.status === 'draft'
                                  ? '原项目草稿'
                                  : '已废弃'}
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      ))}
                    </FieldGroup>
                  ) : (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>当前项目暂无共同记忆</EmptyTitle>
                        <EmptyDescription>仍可以复用节点和工作项结构。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </FieldSet>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-sm text-muted-foreground">已选择 {selected.length} 条记忆</span>
            <Button
              type="submit"
              form="reuse-project-form"
              disabled={busy || !isAdmin || !name.trim() || !description.trim()}
            >
              <CopyPlus data-icon="inline-start" />
              创建新项目
            </Button>
          </CardFooter>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>复用范围</CardTitle>
              <CardDescription>经验保留来源，项目状态重新开始。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-5">
                <div className="flex gap-3">
                  <Layers3 aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">节点和工作项结构</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      复用任务说明与验收标准，完成状态和交付成果会重置。
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex gap-3">
                  <FileCheck2 aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">共同记忆草稿</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      需求、约定、决策和经验由新项目负责人重新审核发布。
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex gap-3">
                  <UsersRound aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">重新分配成员</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      新项目独立设置负责人、协作成员和验收人。
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Alert>
            <GitBranch />
            <AlertTitle>新项目保持独立</AlertTitle>
            <AlertDescription>
              来源项目后续变化不会自动覆盖新项目。客户凭证、历史费用、原成员和任务完成状态均不复制。
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
