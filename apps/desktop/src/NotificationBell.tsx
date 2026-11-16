import { useCallback, useEffect, useState } from 'react';
import { Bell, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { Api } from './types';
import { formatTime } from './types';
import { toast } from 'sonner';
interface Notification {
  id: string;
  memberId: string;
  projectId: string;
  kind: string;
  title: string;
  body: string;
  taskId?: string;
  issueId?: string;
  handoverId?: string;
  createdAt: string;
  readAt?: string;
}
export default function NotificationBell({
  api,
  onNavigate,
}: {
  api: Api;
  onNavigate: (n: Notification) => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setItems((await api<Notification[]>('/api/notifications')) || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '通知同步失败');
    }
  }, [api]);
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(t);
  }, [load]);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`通知，${unread}条未读`}
          className="relative"
        >
          <Bell />
          {unread > 0 && (
            <Badge className="absolute -right-1 -top-1 px-1">{unread > 99 ? '99+' : unread}</Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuGroup>
          <DropdownMenuLabel>工作通知{unread ? ` · ${unread} 条未读` : ''}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup className="max-h-96 overflow-auto">
          {error ? (
            <DropdownMenuItem disabled>{error}</DropdownMenuItem>
          ) : !items.length ? (
            <DropdownMenuItem disabled>暂无工作通知</DropdownMenuItem>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onClick={async () => {
                  try {
                    await api(`/api/notifications/${n.id}/read`, 'POST', {});
                    setItems((prev) =>
                      prev.map((i) =>
                        i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i,
                      ),
                    );
                    onNavigate(n);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : '通知读取失败');
                  }
                }}
              >
                <div className="flex w-full flex-col gap-1 py-1">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-medium">{n.title}</span>
                    {!n.readAt && <Badge variant="secondary">未读</Badge>}
                    <ArrowUpRight />
                  </div>
                  <span className="line-clamp-2 text-sm text-muted-foreground">{n.body}</span>
                  <span className="text-xs text-muted-foreground">{formatTime(n.createdAt)}</span>
                </div>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
