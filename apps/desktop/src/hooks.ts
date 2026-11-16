import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi, loadConnection, saveConnection } from './api';
import type { Connection, Member, Project, Snapshot } from './types';

export function useWorkspace() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const refreshGeneration = useRef(0);
  const api = useMemo(() => createApi(connection || { baseUrl: '', token: '' }), [connection]);
  const reportError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      setMe(null);
      setData(null);
      setProjects([]);
      setMembers([]);
    }
    setError(e instanceof Error ? e.message : '操作失败');
  }, []);
  useEffect(() => {
    loadConnection()
      .then(setConnection)
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  const refresh = useCallback(async () => {
    if (!connection) return;
    const generation = ++refreshGeneration.current;
    const requestedId = projectId;
    const [nextMe, nextMembers, nextProjects] = await Promise.all([
      api<Member>('/api/me'),
      api<Member[]>('/api/members'),
      api<Project[]>('/api/projects'),
    ]);
    if (generation !== refreshGeneration.current || requestedId !== projectRef.current) return;
    setMe(nextMe);
    setMembers(nextMembers || []);
    setProjects(nextProjects || []);
    const id = nextProjects?.some((p) => p.id === projectId)
      ? projectId
      : nextProjects?.[0]?.id || '';
    if (id !== projectId) {
      setProjectId(id);
    }
    if (id) {
      const snapshot = await api<Snapshot>(`/api/projects/${id}/snapshot`);
      if (
        generation !== refreshGeneration.current ||
        (projectRef.current && projectRef.current !== id)
      )
        return;
      setData({
        ...snapshot,
        nodes: snapshot.nodes || [],
        tasks: snapshot.tasks || [],
        memories: snapshot.memories || [],
        issues: snapshot.issues || [],
        events: snapshot.events || [],
        usage: snapshot.usage || [],
        members: snapshot.members || [],
        handovers: snapshot.handovers || [],
      });
    } else {
      setData(null);
    }
  }, [api, connection, projectId]);
  useEffect(() => {
    if (!connection) return;
    let alive = true;
    setLoading(true);
    refresh()
      .catch((e) => {
        if (alive) reportError(e);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh, connection, reportError]);
  useEffect(() => {
    if (!connection || !me) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh().catch(reportError);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [connection, me, refresh, reportError]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const run = async <T>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      try {
        await refresh();
      } catch (e) {
        setError(`操作已保存，但刷新失败：${e instanceof Error ? e.message : '请稍后重试'}`);
      }
      if (success) setToast(success);
      return result;
    } catch (e) {
      reportError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const connect = async (value: Connection) => {
    setBusy(true);
    setError('');
    try {
      const checked = {
        baseUrl: value.baseUrl.trim().replace(/\/$/, ''),
        token: value.token.trim(),
      };
      if (!/^https?:\/\//.test(checked.baseUrl))
        throw new Error('服务地址需要以 http:// 或 https:// 开头');
      await createApi(checked)<Member>('/api/me');
      await saveConnection(checked);
      setMe(null);
      setData(null);
      setProjectId('');
      setConnection(checked);
      setToast('已连接协同空间');
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setBusy(false);
    }
  };
  const switchProject = (id: string) => {
    if (id !== projectId) {
      setData(null);
      setProjectId(id);
    }
  };
  return {
    connection,
    ready,
    me,
    members,
    projects,
    projectId,
    setProjectId: switchProject,
    data,
    error,
    setError,
    toast,
    busy,
    loading,
    api,
    refresh,
    run,
    connect,
  };
}
