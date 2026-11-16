import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { ApiError } from '../api';
import { PageHeader } from '../components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatTime } from '../types';
import type { Api, OrganizationOverview, OrganizationProject } from '../types';

const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
const costSources = { reported: '上报金额', estimated: '估算金额', unknown: '来源未知' };
const needsAttention = (item: OrganizationProject) =>
  item.tasks.blocked > 0 ||
  item.tasks.review > 0 ||
  item.openIssues > 0 ||
  item.pendingHandovers > 0 ||
  item.tasks.unassigned > 0;

export default function Organization({
  api,
  refreshKey,
  onOpenProject,
  onCreateProject,
}: {
  api: Api;
  refreshKey: number;
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
}) {
  const [data, setData] = useState<OrganizationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [localRefresh, setLocalRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let active = true;
    let running = false;
    setData(null);
    setLoading(true);
    setError('');
    const load = async () => {
      if (running || document.hidden) return;
      running = true;
      setRefreshing(true);
      try {
        const result = await api<OrganizationOverview>('/api/organization/overview');
        if (active) {
          setData({
            ...result,
            costs: result.costs || [],
            projects: (result.projects || []).map((item) => ({
              ...item,
              nodeOwners: item.nodeOwners || [],
              costs: item.costs || [],
            })),
          });
          setError('');
        }
      } catch (exception) {
        if (active) {
          if (
            exception instanceof ApiError &&
            (exception.status === 401 || exception.status === 403)
          )
            setData(null);
          setError(exception instanceof Error ? exception.message : '组织总览同步失败');
        }
      } finally {
        running = false;
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [api, refreshKey, localRefresh]);

  const refresh = () => setLocalRefresh((value) => value + 1);
  const attention = data?.projects.filter(needsAttention).length || 0;
  const rows = (data?.projects || [])
    .filter((item) => {
      const matchesFilter = filter !== 'attention' || needsAttention(item);
      const term = query.trim().toLocaleLowerCase();
      const haystack = [
        item.project.name,
        item.project.description,
        ...item.nodeOwners.map((owner) => owner.name),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return matchesFilter && (!term || haystack.includes(term));
    })
    .sort(
      (a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt) ||
        a.project.name.localeCompare(b.project.name),
    );
  const overall = data?.totals.totalTasks
    ? Math.round((data.totals.doneTasks / data.totals.totalTasks) * 100)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="组织总览"
        description="统一查看全部项目的交付进度、待处理事项和已上报 AI 用量。"
        actions={
          <>
            <Button variant="outline" disabled={refreshing} onClick={refresh}>
              <RefreshCw
                data-icon="inline-start"
                className={refreshing ? 'animate-spin' : undefined}
              />
              刷新
            </Button>
            <Button onClick={onCreateProject}>
              <Plus data-icon="inline-start" />
              创建项目
            </Button>
          </>
        }
      />
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>组织总览暂未同步</AlertTitle>
          <AlertDescription>
            {error}
            {data && ' 当前仍显示上次成功同步的数据。'}
            <Button variant="outline" size="sm" disabled={refreshing} onClick={refresh}>
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {loading && !data ? (
        <div role="status" aria-label="正在加载组织总览" className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : !data ? (
        !error && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>尚未获取组织数据</EmptyTitle>
              <EmptyDescription>刷新后查看所有项目的状态。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={refresh}>加载组织总览</Button>
            </EmptyContent>
          </Empty>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Metric
              label="全部项目"
              value={number(data.totals.projectCount)}
              detail={`${number(data.totals.activeMemberCount)} 位有效成员 · ${number(attention)} 个项目需关注`}
              icon={<Building2 />}
            />
            <Metric
              label="整体任务验收"
              value={overall === null ? '—' : `${overall}%`}
              detail={`${number(data.totals.doneTasks)} / ${number(data.totals.totalTasks)} 项任务已验收`}
              icon={<CheckCircle2 />}
            />
            <Metric
              label="等待验收"
              value={number(data.totals.reviewTasks)}
              detail={`${number(data.totals.blockedTasks)} 项阻塞 · ${number(data.totals.openIssues)} 个未解决问题`}
              icon={<FileCheck2 />}
            />
            <Metric
              label="已上报 Token"
              value={number(data.totals.inputTokens + data.totals.outputTokens)}
              detail={`${number(data.totals.requestCount)} 次执行 · 输入已含缓存读取`}
              icon={<Activity />}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>全部项目</CardTitle>
              <CardDescription>在同一处比较项目进展，进入项目后查看节点和工作项。</CardDescription>
              <CardAction>
                <Badge variant="outline">
                  {number(rows.length)} / {number(data.projects.length)} 个项目
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <InputGroup className="max-w-sm">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="搜索项目或负责人"
                    placeholder="搜索项目或负责人"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </InputGroup>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={filter}
                  onValueChange={(value) => {
                    if (value) setFilter(value);
                  }}
                  aria-label="筛选项目"
                >
                  <ToggleGroupItem value="all">全部项目</ToggleGroupItem>
                  <ToggleGroupItem value="attention">需关注 · {number(attention)}</ToggleGroupItem>
                </ToggleGroup>
              </div>
              {!data.projects.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Building2 />
                    </EmptyMedia>
                    <EmptyTitle>从第一个项目开始</EmptyTitle>
                    <EmptyDescription>创建项目后，即可在这里查看跨项目进度。</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={onCreateProject}>
                      <Plus data-icon="inline-start" />
                      创建项目
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : !rows.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Search />
                    </EmptyMedia>
                    <EmptyTitle>没有匹配的项目</EmptyTitle>
                    <EmptyDescription>调整关键词或切换到全部项目。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>项目</TableHead>
                      <TableHead>节点负责人</TableHead>
                      <TableHead>交付进度</TableHead>
                      <TableHead>需要关注</TableHead>
                      <TableHead>已上报 Token</TableHead>
                      <TableHead>最近变更</TableHead>
                      <TableHead>
                        <span className="sr-only">进入项目</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((item) => (
                      <ProjectRow
                        key={item.project.id}
                        item={item}
                        onOpen={() => onOpenProject(item.project.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            <CardFooter className="flex-wrap justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                每 15 秒同步 · {formatTime(data.generatedAt)}
              </span>
              <span className="text-sm text-muted-foreground">
                进度按已验收任务计算；尚无任务的项目显示 —。
              </span>
            </CardFooter>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>跨项目待处理事项</CardTitle>
                <CardDescription>已读通知与完成验收、解决问题分别记录。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-5">
                  <Count label="待验收任务" value={data.totals.reviewTasks} />
                  <Count label="阻塞任务" value={data.totals.blockedTasks} />
                  <Count label="未解决问题" value={data.totals.openIssues} />
                  <Count label="待确认交接" value={data.totals.pendingHandovers} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>已上报费用</CardTitle>
                <CardDescription>币种和金额来源分别统计，缺失金额不作估算。</CardDescription>
              </CardHeader>
              <CardContent>
                {data.costs.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>币种</TableHead>
                        <TableHead>来源</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.costs.map((cost) => (
                        <TableRow key={`${cost.currency}-${cost.source}`}>
                          <TableCell>{cost.currency}</TableCell>
                          <TableCell>{costSources[cost.source]}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(
                              cost.amount,
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>暂无金额上报</EmptyTitle>
                      <EmptyDescription>当前只展示已获取的 Token 计量。</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
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
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{number(value)}</span>
    </div>
  );
}
function ProjectRow({ item, onOpen }: { item: OrganizationProject; onOpen: () => void }) {
  const percent = item.tasks.total ? Math.round((item.tasks.done / item.tasks.total) * 100) : null;
  return (
    <TableRow onClick={onOpen} className="cursor-pointer">
      <TableCell className="max-w-72 whitespace-normal">
        <Button
          variant="link"
          className="h-auto max-w-full justify-start whitespace-normal p-0 text-left"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {item.project.name}
        </Button>
        {item.project.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {item.project.description}
          </p>
        )}
      </TableCell>
      <TableCell className="max-w-52 whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {item.nodeOwners.length ? (
            item.nodeOwners.slice(0, 3).map((owner) => (
              <Badge key={owner.id} variant="outline">
                {owner.name}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">未分配</span>
          )}
          {item.nodeOwners.length > 3 && (
            <Badge variant="secondary">+{item.nodeOwners.length - 3}</Badge>
          )}
        </div>
        {item.unassignedNodeCount > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {item.unassignedNodeCount} 个节点待分工
          </p>
        )}
      </TableCell>
      <TableCell className="min-w-32">
        <div className="flex flex-col gap-2">
          <span className="tabular-nums">
            {percent === null ? '—' : `${percent}%`}
            <span className="ml-2 text-xs text-muted-foreground">
              {item.tasks.done}/{item.tasks.total} 已验收
            </span>
          </span>
          {percent !== null && (
            <Progress value={percent} aria-label={`${item.project.name}已验收进度`} />
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-56 whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {item.tasks.blocked > 0 && <Badge variant="destructive">阻塞 {item.tasks.blocked}</Badge>}
          {item.openIssues > 0 && <Badge variant="outline">问题 {item.openIssues}</Badge>}
          {item.tasks.review > 0 && <Badge variant="secondary">待验收 {item.tasks.review}</Badge>}
          {item.pendingHandovers > 0 && (
            <Badge variant="outline">交接 {item.pendingHandovers}</Badge>
          )}
          {item.tasks.unassigned > 0 && (
            <Badge variant="outline">任务待分工 {item.tasks.unassigned}</Badge>
          )}
          {!needsAttention(item) && (
            <span className="text-sm text-muted-foreground">暂无待处理事项</span>
          )}
        </div>
      </TableCell>
      <TableCell className="tabular-nums">
        {number(item.usage.inputTokens + item.usage.outputTokens)}
        <p className="mt-1 text-xs text-muted-foreground">{number(item.usage.requests)} 次执行</p>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatTime(item.lastActivityAt)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`进入项目：${item.project.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ArrowUpRight />
        </Button>
      </TableCell>
    </TableRow>
  );
}
