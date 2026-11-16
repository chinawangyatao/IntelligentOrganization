import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Bot, FolderOpen, Play, RefreshCw, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, Notice } from './components';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Field as UIField, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group';
import { AppSelect, AppSelectOption } from '@/components/AppSelect';
import { formatTime, memberName } from './types';
import type { PageProps, Task, WorkSession } from './types';

interface LocalStatus {
  available: boolean;
  workspacePath?: string;
  session?: WorkSession;
}
interface LaunchResult {
  nativeSessionId: string;
  warnings: string[];
}
const native = () => '__TAURI_INTERNALS__' in window;
const labels = { prepared: '待启动', active: '已绑定', revoked: '已撤销', expired: '已到期' };

export default function TaskWorkSessions({
  data,
  serviceUrl,
  me,
  members,
  api,
  task,
}: PageProps & { task: Task }) {
  const workspaceId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const assertCurrent = () => {
    if (!alive.current) throw new Error('任务页面已切换，请在当前任务重新启动。');
  };
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [local, setLocal] = useState<Record<string, LocalStatus>>({});
  const [workspace, setWorkspace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const path = `/api/projects/${data.project.id}/tasks/${task.id}/work-sessions`;
  const refresh = useCallback(async () => {
    const result = (await api<WorkSession[]>(path)) || [];
    if (!alive.current) return;
    setSessions(result);
    if (native()) {
      const statuses = await Promise.all(
        result
          .filter((s) => s.memberId === me.id)
          .map(async (s) => {
            try {
              return [
                s.id,
                await invoke<LocalStatus>('work_session_local_status', { bindingId: s.id }),
              ] as const;
            } catch {
              return [s.id, { available: false }] as const;
            }
          }),
      );
      if (alive.current) setLocal(Object.fromEntries(statuses));
    }
  }, [api, path, me.id]);
  useEffect(() => {
    let alive = true;
    refresh().catch((e) => {
      if (alive) setError(String(e.message || e));
    });
    return () => {
      alive = false;
    };
  }, [refresh]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setWarnings([]);
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) {
        await refresh().catch(() => {});
        if (alive.current) setBusy(false);
      }
    }
  };
  const start = async (s: WorkSession) => {
    if (!native()) throw new Error('请在智能组织桌面 App 中启动 AI 会话。');
    // Retry uses the same locally saved thread ID after a failed attach/open.
    assertCurrent();
    const result = await invoke<LaunchResult>('work_session_launch', {
      bindingId: s.id,
      expectedSession: s,
    });
    assertCurrent();
    const attached = await api<WorkSession>(`/api/work-sessions/${s.id}/attach`, 'POST', {
      nativeSessionId: result.nativeSessionId,
    });
    assertCurrent();
    await invoke('work_session_activate', { session: attached });
    assertCurrent();
    setWarnings(result.warnings || []);
    await invoke('work_session_open', { bindingId: s.id, expectedSession: attached });
    assertCurrent();
    toast.success('已打开绑定此任务的 Codex 会话');
  };
  const create = () =>
    action(async () => {
      if (!native()) throw new Error('请在智能组织桌面 App 中启动 AI 会话。');
      if (!workspace.trim()) throw new Error('请先选择该任务的工作目录。');
      const created = await api<{ session: WorkSession; token: string }>(path, 'POST', {
        host: 'codex',
      });
      try {
        assertCurrent();
        await invoke('work_session_prepare', {
          baseUrl: serviceUrl,
          session: created.session,
          token: created.token,
          workspacePath: workspace.trim(),
        });
      } catch (e) {
        // The one-time grant could not be saved; revoke it so it cannot remain orphaned.
        await api(`/api/work-sessions/${created.session.id}/revoke`, 'POST').catch(() => {});
        throw e;
      }
      assertCurrent();
      await start(created.session);
    });
  const visible = sessions.filter((s) => !['revoked', 'expired'].includes(s.status));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" />
          AI 工作会话
        </CardTitle>
        <CardDescription>
          从这里进入 AI 工作。会话固定归属此项目和任务，恢复时打开原会话。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          {data.project.name} / {task.title} · {me.name}
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        {warnings.map((w, i) => (
          <Notice key={i}>{w}</Notice>
        ))}
        {!native() && (
          <Notice>当前为浏览器预览，请在智能组织桌面 App 中创建和打开 AI 会话。</Notice>
        )}
        <FieldGroup>
          <Field
            label="AI 工具"
            hint="DeepSeek Harness 的桌面会话启动适配尚未开放，完成后在这里切换。"
          >
            <AppSelect value="codex" disabled>
              <AppSelectOption value="codex">Codex</AppSelectOption>
            </AppSelect>
          </Field>
          <UIField>
            <FieldLabel htmlFor={workspaceId}>工作目录</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={workspaceId}
                placeholder="选择项目代码或文档目录"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                disabled={busy}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  disabled={busy || !native()}
                  onClick={() =>
                    action(async () => {
                      const picked = await invoke<string | null>('work_session_pick_folder');
                      if (picked && alive.current) setWorkspace(picked);
                    })
                  }
                >
                  <FolderOpen data-icon="inline-start" />
                  选择
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>仅用于打开工具的工作区；项目归属由会话绑定确定。</FieldDescription>
          </UIField>
        </FieldGroup>
        <div className="flex gap-2">
          <Button
            disabled={busy || !native() || !workspace.trim() || task.status === 'done'}
            onClick={create}
          >
            <Play />
            新建并打开会话
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="刷新工作会话"
            disabled={busy}
            onClick={() => action(refresh)}
          >
            <RefreshCw />
          </Button>
        </div>
        {visible.length > 0 && (
          <div className="flex flex-col gap-3">
            {visible.map((s) => (
              <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {s.host === 'codex' ? 'Codex' : 'DeepSeek Harness'} ·{' '}
                    {memberName(members, s.memberId)}
                  </span>
                  <Badge variant={s.status === 'active' ? 'outline' : 'secondary'}>
                    {labels[s.status]}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    到期 {formatTime(s.expiresAt)}
                  </span>
                </div>
                {s.memberId === me.id && (
                  <>
                    <p className="truncate text-xs text-muted-foreground">
                      {local[s.id]?.workspacePath ||
                        '此会话的授权未保存在本机，可在原设备恢复，或新建会话。'}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={
                          busy || !native() || !local[s.id]?.available || s.host !== 'codex'
                        }
                        onClick={() => action(() => start(s))}
                      >
                        {s.status === 'active' ? '恢复会话' : '继续启动'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            await api(`/api/work-sessions/${s.id}/revoke`, 'POST');
                            if (native() && local[s.id]?.available)
                              await invoke('work_session_forget', { bindingId: s.id });
                            if (alive.current) toast.success('会话授权已撤销');
                          })
                        }
                      >
                        <ShieldX />
                        撤销授权
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          首次使用请在 Codex 审核并信任上下文
          Hooks，之后可在每轮开始时读取最新项目依据。需求变更仍需确认基线，成果仍由责任人验收。
        </p>
      </CardContent>
    </Card>
  );
}
