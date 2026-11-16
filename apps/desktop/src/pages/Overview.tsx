import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  ArrowRight,
} from 'lucide-react';
import { Button, Empty, PageHeader, PersonAvatar } from '../components';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { formatTime, memberName } from '../types';
import type { PageProps } from '../types';
export default function Overview({
  data,
  members,
  onNavigate,
}: PageProps & { onNavigate: (page: string) => void }) {
  const done = data.tasks.filter((t) => t.status === 'done').length;
  const review = data.tasks.filter((t) => t.status === 'review').length;
  const blocked = data.tasks.filter((t) => t.status === 'blocked').length;
  const issues = data.issues.filter((i) => i.status !== 'resolved');
  const percent = data.tasks.length ? Math.round((done / data.tasks.length) * 100) : 0;
  const metrics = [
    {
      title: '已验收任务',
      value: done,
      detail: `共 ${data.tasks.length} 项工作`,
      icon: CheckCircle2,
    },
    { title: '待验收', value: review, detail: '等待负责人确认成果', icon: FileCheck2 },
    {
      title: '未解决问题',
      value: issues.length,
      detail: `${blocked} 项任务受阻`,
      icon: CircleAlert,
    },
    {
      title: '已发布记忆',
      value: data.memories.filter((m) => m.status === 'published').length,
      detail: `${data.memories.filter((m) => m.status === 'draft').length} 条草稿待确认`,
      icon: BookIcon,
    },
  ];
  return (
    <>
      <PageHeader
        title="项目总览"
        description={data.project.description || '查看节点分工、交付进度和需要处理的事项。'}
        actions={
          <Button variant="secondary" onClick={() => onNavigate('tasks')}>
            查看工作项
            <ArrowUpRight />
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.title}>
            <CardHeader>
              <CardDescription>{m.title}</CardDescription>
              <CardAction>
                <m.icon className="size-4 text-muted-foreground" />
              </CardAction>
              <CardTitle className="text-3xl tabular-nums">{m.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{m.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>节点进度</CardTitle>
            <CardDescription>已验收成果计入完成进度</CardDescription>
            <CardAction>
              <Badge variant="secondary">{percent}% 已完成</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Progress value={percent} className="mb-5" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>协作节点</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>任务完成</TableHead>
                  <TableHead className="w-24">进度</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.nodes]
                  .sort((a, b) => a.position - b.position)
                  .map((n) => {
                    const tasks = data.tasks.filter((t) => t.nodeId === n.id);
                    const finished = tasks.filter((t) => t.status === 'done').length;
                    return (
                      <TableRow key={n.id}>
                        <TableCell className="font-medium">{n.name}</TableCell>
                        <TableCell>
                          {n.ownerIds?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {n.ownerIds.map((id) => (
                                <Badge key={id} variant="outline">
                                  {memberName(members, id)}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">未分配</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {finished} / {tasks.length}
                        </TableCell>
                        <TableCell>
                          <Progress value={tasks.length ? (finished / tasks.length) * 100 : 0} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter>
            <Button variant="ghost" className="ml-auto" onClick={() => onNavigate('people')}>
              管理节点分工
              <ArrowRight />
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>待处理事项</CardTitle>
            <CardDescription>问题、阻塞和等待验收的工作</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!issues.length && !review && !blocked ? (
              <Empty title="暂无待处理事项" detail="需要负责人行动的工作会显示在这里。" />
            ) : (
              <>
                {issues.slice(0, 4).map((i) => (
                  <div key={i.id} className="flex items-start gap-3">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <button
                        className="text-left text-sm font-medium hover:underline"
                        onClick={() => onNavigate('issues')}
                      >
                        {i.title}
                      </button>
                      <p className="text-sm text-muted-foreground">
                        {memberName(members, i.assigneeId)} ·{' '}
                        {i.status === 'open' ? '等待接单' : '处理中'}
                      </p>
                    </div>
                    <Badge variant="outline">问题</Badge>
                  </div>
                ))}
                {!!issues.length && (review > 0 || blocked > 0) && <Separator />}
                {data.tasks
                  .filter((t) => t.status === 'review' || t.status === 'blocked')
                  .slice(0, 4)
                  .map((t) => (
                    <div key={t.id} className="flex items-start gap-3">
                      <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <button
                          className="text-left text-sm font-medium hover:underline"
                          onClick={() => onNavigate('tasks')}
                        >
                          {t.title}
                        </button>
                        <p className="text-sm text-muted-foreground">
                          {memberName(members, t.status === 'review' ? t.reviewerId : t.ownerId)}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        {t.status === 'review' ? '待验收' : '已阻塞'}
                      </Badge>
                    </div>
                  ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>项目动态</CardTitle>
          <CardDescription>提交、变更与交接记录</CardDescription>
        </CardHeader>
        <CardContent>
          {data.events.length ? (
            <div className="flex flex-col gap-4">
              {[...data.events]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 8)
                .map((e) => (
                  <div key={e.id} className="flex items-start gap-3">
                    <PersonAvatar name={memberName(members, e.actorId)} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="text-sm">{e.message}</p>
                      <span className="text-xs text-muted-foreground">
                        {memberName(members, e.actorId)}
                      </span>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {formatTime(e.createdAt)}
                    </time>
                  </div>
                ))}
            </div>
          ) : (
            <Empty title="暂无项目动态" detail="创建任务、发布记忆和变更责任人后会自动记录。" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
function BookIcon(props: React.ComponentProps<typeof FileCheck2>) {
  return <FileCheck2 {...props} />;
}
