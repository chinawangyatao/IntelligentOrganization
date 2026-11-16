import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api, Message, MessagePage } from '../types';

export function mergeMessages(...pages: Message[][]): Message[] {
  const unique = new Map<string, Message>();
  for (const page of pages) for (const message of page) unique.set(message.id, message);
  return [...unique.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
export function useConversationMessages(
  api: Api,
  conversationId: string,
  onChange: () => Promise<unknown>,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [receipts, setReceipts] = useState<MessagePage['receipts']>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(document.hidden);
  const [lastSynced, setLastSynced] = useState('');
  const [coverageComplete, setCoverageComplete] = useState(false);
  const active = useRef(false);
  const currentId = useRef(conversationId);
  const messagesRef = useRef<Message[]>([]);
  const inFlight = useRef(false);
  const lastRead = useRef('');
  const syncedTail = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const valid = useCallback((id: string) => active.current && currentId.current === id, []);
  const sync = useCallback(
    async (initial = false) => {
      const id = conversationId;
      if (inFlight.current || document.hidden) return;
      inFlight.current = true;
      setSyncing(true);
      try {
        const firstLoad = !initialized.current;
        const knownLatest = syncedTail.current;
        let page = await api<MessagePage>(`/api/conversations/${id}/messages?limit=100`);
        let incoming = page.messages || [];
        const latestReceipts = page.receipts || [];
        while (
          !firstLoad &&
          page.hasMore &&
          (!knownLatest || !incoming.some((m) => m.id === knownLatest))
        ) {
          if (!valid(id)) return;
          const before = page.messages[0]?.id;
          if (!before) throw new Error('消息分页未返回有效游标');
          page = await api<MessagePage>(
            `/api/conversations/${id}/messages?limit=100&before=${encodeURIComponent(before)}`,
          );
          if (!page.messages?.length && page.hasMore)
            throw new Error('消息历史未能完整同步，请重试');
          incoming = mergeMessages(page.messages || [], incoming);
        }
        if (!valid(id)) return;
        const merged = firstLoad ? incoming : mergeMessages(messagesRef.current, incoming);
        messagesRef.current = merged;
        initialized.current = true;
        syncedTail.current = incoming.at(-1)?.id;
        setCoverageComplete(
          !merged.length || incoming.some((message) => message.id === merged.at(-1)?.id),
        );
        setMessages(merged);
        setReceipts(latestReceipts);
        if (firstLoad || !page.hasMore) setHasMore(page.hasMore);
        setLastSynced(new Date().toISOString());
        setError('');
      } catch (e) {
        if (valid(id)) setError(e instanceof Error ? e.message : '消息同步失败');
      } finally {
        if (valid(id)) {
          setLoading(false);
          setSyncing(false);
        }
        inFlight.current = false;
      }
    },
    [api, conversationId, valid],
  );
  useEffect(() => {
    active.current = true;
    currentId.current = conversationId;
    void sync(true);
    const timer = setInterval(() => {
      if (!document.hidden) void sync();
    }, 3000);
    const visibility = () => {
      setPaused(document.hidden);
      if (!document.hidden) void sync(messagesRef.current.length === 0);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [conversationId, sync]);
  const older = async () => {
    const id = conversationId;
    const first = messagesRef.current[0]?.id;
    if (!first || loadingOlder || inFlight.current) return;
    setLoadingOlder(true);
    try {
      const page = await api<MessagePage>(
        `/api/conversations/${id}/messages?limit=100&before=${encodeURIComponent(first)}`,
      );
      if (!valid(id)) return;
      const merged = mergeMessages(page.messages || [], messagesRef.current);
      messagesRef.current = merged;
      setMessages(merged);
      setHasMore(page.hasMore);
      setError('');
    } catch (e) {
      if (valid(id)) setError(e instanceof Error ? e.message : '历史消息加载失败');
    } finally {
      if (valid(id)) setLoadingOlder(false);
    }
  };
  const send = async (body: string, mentionIds: string[]): Promise<boolean> => {
    const id = conversationId;
    if (sending || !coverageComplete || !body.trim()) return false;
    setSending(true);
    setCoverageComplete(false);
    try {
      const message = await api<Message>(`/api/conversations/${id}/messages`, 'POST', {
        body,
        mentionIds,
      });
      if (!valid(id)) return false;
      const merged = mergeMessages(messagesRef.current, [message]);
      messagesRef.current = merged;
      setMessages(merged);
      setError('');
      try {
        await changeRef.current();
      } catch (e) {
        if (valid(id))
          setError(`消息已发送，列表刷新失败：${e instanceof Error ? e.message : '请稍后重试'}`);
      }
      if (valid(id)) await sync();
      return valid(id);
    } catch (e) {
      if (valid(id)) {
        setCoverageComplete(true);
        setError(e instanceof Error ? e.message : '消息发送失败');
      }
      return false;
    } finally {
      if (valid(id)) setSending(false);
    }
  };
  const read = useCallback(
    async (id: string) => {
      const cid = conversationId;
      if (!valid(cid) || document.hidden || inFlight.current || lastRead.current === id) return;
      lastRead.current = id;
      try {
        await api(`/api/conversations/${cid}/read`, 'POST', { messageId: id });
        if (valid(cid)) await changeRef.current();
      } catch (e) {
        if (valid(cid)) {
          lastRead.current = '';
          setError(e instanceof Error ? e.message : '已读状态同步失败');
        }
      }
    },
    [api, conversationId, valid],
  );
  return {
    messages,
    receipts,
    hasMore,
    loading,
    coverageComplete,
    syncing,
    loadingOlder,
    sending,
    error,
    paused,
    lastSynced,
    older,
    send,
    read,
    refresh: () => sync(),
  };
}
