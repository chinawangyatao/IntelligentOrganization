import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  KanbanSquare,
  BookOpen,
  CircleAlert,
  UsersRound,
  GitBranch,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  RefreshCw,
  MessageSquare,
  LogOut,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Empty, Field, Loading, Modal, Notice, PersonAvatar } from './components';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/sonner';
import { useWorkspace } from './hooks';
import { clearConnection } from './api';
import type { ConversationScope, Project, Snapshot } from './types';
import Overview from './pages/Overview';
import Tasks from './pages/Tasks';
import Memory from './pages/Memory';
import Issues from './pages/Issues';
import People from './pages/People';
import Reuse from './pages/Reuse';
import Usage from './pages/Usage';
import Settings from './pages/Settings';
import Communication from './pages/Communication';
import NotificationBell from './NotificationBell';

const navigation = [
  { id: 'overview', label: '项目总览', icon: LayoutDashboard },
  { id: 'tasks', label: '节点与任务', icon: KanbanSquare },
  { id: 'communication', label: '团队通信', icon: MessageSquare },
  { id: 'memories', label: '共享记忆', icon: BookOpen },
  { id: 'issues', label: '问题与反馈', icon: CircleAlert },
  { id: 'people', label: '成员与交接', icon: UsersRound },
  { id: 'reuse', label: '经验复用', icon: GitBranch },
  { id: 'usage', label: 'AI 用量', icon: ChartNoAxesCombined },
];
export default function App() {
  const w = useWorkspace();
  const [page, setPage] = useState('overview');
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [requestedScope, setRequestedScope] = useState<ConversationScope | null>(null);
  const [focusTaskId, setFocusTaskId] = useState('');
  const opened = useCallback(() => setRequestedScope(null), []);
  const discuss = (scope: ConversationScope) => {
    setRequestedScope(scope);
    setPage('communication');
  };
  const disconnect = async () => {
    try {
      await clearConnection();
      window.location.reload();
    } catch (e) {
      w.setError(e instanceof Error ? e.message : '断开连接失败');
    }
  };
  useEffect(() => {
    if (w.toast) toast.success(w.toast);
  }, [w.toast]);
  const status = <>{w.error && <Notice kind="error">{w.error}</Notice>}</>;
  if (!w.ready) return <Loading label="正在加载工作空间…" />;
  if (!w.connection || !w.me)
    return (
      <>
        <Toaster />
        {w.connection && w.loading ? (
          <Loading label="正在验证协同服务…" />
        ) : (
          <Settings
            connection={w.connection}
            busy={w.busy}
            onConnect={w.connect}
            onDisconnect={disconnect}
            error={w.error}
            standalone
          />
        )}
      </>
    );
  const emptyData: Snapshot = {
    project: { id: '', name: '', description: '', status: 'active', createdAt: '' },
    nodes: [],
    tasks: [],
    memories: [],
    issues: [],
    events: [],
    usage: [],
    members: w.members,
    handovers: [],
  };
  const shared = {
    data: w.data || emptyData,
    members: w.members,
    me: w.me,
    api: w.api,
    run: w.run,
    busy: w.busy,
    onDiscuss: discuss,
  };
  const current = navigation.find((n) => n.id === page);
  return (
    <SidebarProvider style={{ '--sidebar-width': '16rem' } as React.CSSProperties}>
      <Toaster />
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={() => setPage('overview')}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Building2 />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">微梦 · 智能组织</span>
                  <span className="truncate text-xs text-muted-foreground">项目协同工作台</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex flex-col gap-3 px-2 py-3 group-data-[collapsible=icon]:hidden">
            <NativeSelect
              className="w-full"
              aria-label="选择项目"
              value={w.projectId}
              onChange={(e) => {
                w.setProjectId(e.target.value);
                setRequestedScope(null);
              }}
            >
              {!w.projects.length && <NativeSelectOption value="">尚无项目</NativeSelectOption>}
              {w.projects.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {w.me.role === 'admin' && (
              <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
                <Plus />
                创建项目
              </Button>
            )}
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>项目协作</SidebarGroupLabel>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={page === item.id}
                    tooltip={item.label}
                    onClick={() => setPage(item.id)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {item.id === 'issues' &&
                      !!w.data?.issues.filter((i) => i.status !== 'resolved').length && (
                        <Badge variant="secondary" className="ml-auto">
                          {w.data.issues.filter((i) => i.status !== 'resolved').length}
                        </Badge>
                      )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={page === 'settings'}
                tooltip="连接设置"
                onClick={() => setPage('settings')}
              >
                <Settings2 />
                <span>连接设置</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={() => setPage('settings')}>
                <PersonAvatar name={w.me.name} />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">{w.me.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {w.me.role === 'admin' ? '组织管理员' : '协作成员'}
                  </span>
                </div>
                <LogOut
                  onClick={(e) => {
                    e.stopPropagation();
                    void disconnect();
                  }}
                  aria-label="断开连接"
                />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-5">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span className="truncate text-muted-foreground">
              {w.data?.project.name || '工作空间'}
            </span>
            <span className="text-muted-foreground">/</span>
            <span className="shrink-0 font-medium">
              {page === 'settings' ? '连接设置' : current?.label}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="刷新项目数据"
            disabled={w.busy}
            onClick={() => w.run(() => w.refresh(), '项目数据已同步')}
          >
            <RefreshCw data-icon="inline-start" className={w.busy ? 'animate-spin' : undefined} />
          </Button>
          <NotificationBell
            api={w.api}
            onNavigate={(notification) => {
              w.setProjectId(notification.projectId);
              if (notification.taskId) {
                setFocusTaskId(notification.taskId);
                setPage('tasks');
              } else if (notification.issueId) {
                setPage('issues');
              } else if (notification.handoverId) {
                setPage('people');
              } else setPage('overview');
            }}
          />
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
          {status}
          {page === 'settings' ? (
            <Settings
              connection={w.connection}
              me={w.me}
              busy={w.busy}
              onConnect={w.connect}
              onDisconnect={disconnect}
            />
          ) : page === 'communication' ? (
            <Communication
              key={w.projectId}
              {...shared}
              requestedScope={requestedScope}
              onScopeOpened={opened}
            />
          ) : w.loading && !w.data ? (
            <Loading />
          ) : !w.data ? (
            <Empty
              title="暂无可访问的项目"
              detail={
                w.me.role === 'admin'
                  ? '创建项目后，配置节点成员和共同记忆。'
                  : '管理员将你加入项目后，可以在这里开展协作。'
              }
              action={
                w.me.role === 'admin' ? (
                  <Button onClick={() => setCreating(true)}>
                    <Plus />
                    创建项目
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {page === 'overview' && <Overview {...shared} onNavigate={setPage} />}{' '}
              {page === 'tasks' && (
                <Tasks
                  key={w.projectId}
                  {...shared}
                  focusTaskId={focusTaskId}
                  onFocusConsumed={() => setFocusTaskId('')}
                />
              )}{' '}
              {page === 'memories' && <Memory {...shared} />}{' '}
              {page === 'issues' && <Issues {...shared} />}{' '}
              {page === 'people' && <People {...shared} />}{' '}
              {page === 'reuse' && (
                <Reuse
                  key={w.projectId}
                  {...shared}
                  onProjectCreated={(id) => {
                    w.setProjectId(id);
                    setPage('overview');
                  }}
                />
              )}{' '}
              {page === 'usage' && <Usage {...shared} />}
            </>
          )}
        </main>
      </SidebarInset>
      {creating && (
        <Modal
          title="创建项目"
          subtitle="创建协作节点，并为团队建立独立的项目空间。"
          onClose={() => setCreating(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await w.run(
                () => w.api<Project>('/api/projects', 'POST', { name: projectName, description }),
                '项目已创建',
              );
              if (result) {
                w.setProjectId(result.id);
                setPage('overview');
                setCreating(false);
                setProjectName('');
                setDescription('');
              }
            }}
          >
            <FieldGroup>
              <Field label="项目名称">
                <Input
                  autoFocus
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="例如：客户服务协同平台"
                />
              </Field>
              <Field label="项目目标与需求概述">
                <Textarea
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Notice>
                默认包含售前、产品、UI/UE、前后端、部署、测试与交付节点，均支持多人分工。
              </Notice>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCreating(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={w.busy || !projectName.trim()}>
                  创建项目
                </Button>
              </div>
            </FieldGroup>
          </form>
        </Modal>
      )}
    </SidebarProvider>
  );
}
