import { useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, ChartNoAxesCombined, Coins, Cpu } from 'lucide-react';
import { PageHeader } from '../components';
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
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { memberName, formatTime } from '../types';
import type { PageProps, Usage as UsageRecord } from '../types';

const count = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
type Group = 'member' | 'model' | 'node';

export default function Usage({ data, members }: PageProps) {
  const [group, setGroup] = useState<Group>('member');
  const input = data.usage.reduce((total, usage) => total + usage.inputTokens, 0);
  const output = data.usage.reduce((total, usage) => total + usage.outputTokens, 0);
  const cache = data.usage.reduce((total, usage) => total + usage.cacheReadTokens, 0);
  const groups = new Map<
    string,
    { label: string; input: number; output: number; requests: number }
  >();
  data.usage.forEach((usage) => {
    const key =
      group === 'member'
        ? usage.memberId
        : group === 'model'
          ? `${usage.provider} / ${usage.model}`
          : usage.nodeId || '';
    const label =
      group === 'member'
        ? memberName(members, key)
        : group === 'model'
          ? key
          : data.nodes.find((node) => node.id === key)?.name || '项目公共';
    const item = groups.get(key) || { label, input: 0, output: 0, requests: 0 };
    item.input += usage.inputTokens;
    item.output += usage.outputTokens;
    item.requests++;
    groups.set(key, item);
  });
  const costs = new Map<string, number>();
  data.usage.forEach((usage) => {
    if (usage.cost !== undefined && usage.cost !== null && usage.currency) {
      const key = `${usage.currency} · ${usage.costSource === 'reported' ? '上报金额' : usage.costSource === 'estimated' ? '估算金额' : '来源未知'}`;
      costs.set(key, (costs.get(key) || 0) + usage.cost);
    }
  });
  const maximum = Math.max(1, ...[...groups.values()].map((item) => item.input + item.output));
  const rows = [...groups.entries()].sort(
    ([, a], [, b]) => b.input + b.output - a.input - a.output,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI 用量统计"
        description="按成员、模型和节点归集实际上报的执行消耗。"
        actions={<Badge variant="outline">{data.usage.length} 条执行记录</Badge>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="总 Token"
          value={count(input + output)}
          detail="输入与输出之和"
          icon={<Activity />}
        />
        <Metric
          label="输入 Token"
          value={count(input)}
          detail={`含缓存读取 ${count(cache)}`}
          icon={<Cpu />}
        />
        <Metric
          label="输出 Token"
          value={count(output)}
          detail="模型返回的输出计量"
          icon={<ChartNoAxesCombined />}
        />
        <Metric
          label="有金额记录"
          value={count(
            data.usage.filter((usage) => usage.cost !== undefined && usage.cost !== null).length,
          )}
          detail="按币种与来源分别归集"
          icon={<Coins />}
        />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>用量分布</CardTitle>
            <CardDescription>比较输入与输出 Token 总量</CardDescription>
            <CardAction>
              <ToggleGroup
                type="single"
                value={group}
                onValueChange={(value) => {
                  if (value) setGroup(value as Group);
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="member">成员</ToggleGroupItem>
                <ToggleGroupItem value="model">模型</ToggleGroupItem>
                <ToggleGroupItem value="node">节点</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          </CardHeader>
          <CardContent>
            {rows.length ? (
              <div className="flex flex-col gap-6">
                {rows.map(([key, item]) => (
                  <div key={key} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="truncate text-sm font-medium">{item.label}</span>
                      <span className="shrink-0 text-sm tabular-nums">
                        {count(item.input + item.output)} tokens
                      </span>
                    </div>
                    <Progress value={((item.input + item.output) / maximum) * 100} />
                    <p className="text-sm text-muted-foreground">
                      {item.requests} 次执行 · 输入 {count(item.input)} / 输出 {count(item.output)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Activity />
                  </EmptyMedia>
                  <EmptyTitle>等待第一条用量记录</EmptyTitle>
                  <EmptyDescription>
                    插件上报后会显示执行消耗，未接入调用不计入实际用量。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>费用归集</CardTitle>
            <CardDescription>不同币种与计价来源分别统计</CardDescription>
          </CardHeader>
          <CardContent>
            {costs.size ? (
              <div className="flex flex-col gap-4">
                {[...costs.entries()].map(([key, value], index) => (
                  <div key={key} className="flex flex-col gap-3">
                    {index > 0 && <Separator />}
                    <p className="text-sm text-muted-foreground">{key}</p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {value.toLocaleString('zh-CN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Coins />
                  </EmptyMedia>
                  <EmptyTitle>尚无金额记录</EmptyTitle>
                  <EmptyDescription>上报金额与估算金额会分别标记。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
          <CardFooter>
            <p className="text-sm leading-6 text-muted-foreground">
              输入已包含缓存读取，不重复相加。当前只统计用量，不设置预算限制。
            </p>
          </CardFooter>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>执行记录</CardTitle>
          <CardDescription>保留成员、工作工具、模型与计量来源。</CardDescription>
        </CardHeader>
        <CardContent>
          {data.usage.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>成员 / 工作工具</TableHead>
                  <TableHead>模型 / 供应商</TableHead>
                  <TableHead>输入 Token</TableHead>
                  <TableHead>输出 Token</TableHead>
                  <TableHead>金额与来源</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.usage].reverse().map((usage) => (
                  <UsageRow
                    key={usage.id}
                    record={usage}
                    name={memberName(members, usage.memberId)}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>暂无执行记录</EmptyTitle>
                <EmptyDescription>
                  从 Codex 或 DeepSeek Harness 接入项目任务后，上报记录将在这里归集。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>{icon}</CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
function UsageRow({ record: usage, name }: { record: UsageRecord; name: string }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground">{usage.host}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span>{usage.model}</span>
          <span className="text-muted-foreground">{usage.provider}</span>
        </div>
      </TableCell>
      <TableCell>{count(usage.inputTokens)}</TableCell>
      <TableCell>{count(usage.outputTokens)}</TableCell>
      <TableCell>
        {usage.cost !== undefined && usage.cost !== null ? (
          <div className="flex flex-col gap-1">
            <span>
              {usage.currency} {usage.cost.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}
            </span>
            <span className="text-muted-foreground">
              {usage.costSource === 'reported'
                ? '上报金额'
                : usage.costSource === 'estimated'
                  ? '估算金额'
                  : '来源未知'}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">未上报</span>
        )}
      </TableCell>
      <TableCell>{formatTime(usage.createdAt)}</TableCell>
    </TableRow>
  );
}
