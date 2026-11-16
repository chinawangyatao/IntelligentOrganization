import { useState } from 'react';
import { Building2, ArrowRight, LogOut } from 'lucide-react';
import { Button, Field, Notice, PageHeader, PersonAvatar } from '../components';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FieldGroup } from '@/components/ui/field';
import type { Connection, Member } from '../types';
export default function Settings({
  connection,
  me,
  busy,
  onConnect,
  onDisconnect,
  standalone = false,
  error,
}: {
  connection: Connection | null;
  me?: Member | null;
  busy: boolean;
  onConnect: (c: Connection) => Promise<void>;
  onDisconnect: () => Promise<void>;
  standalone?: boolean;
  error?: string;
}) {
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl || 'http://127.0.0.1:17890');
  const [token, setToken] = useState(connection?.token || '');
  const content = (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{standalone ? '连接协同空间' : '服务连接'}</CardTitle>
        <CardDescription>使用组织服务地址和管理员分配的成员凭证。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="connection-form"
          onSubmit={async (e) => {
            e.preventDefault();
            await onConnect({ baseUrl, token });
          }}
        >
          <FieldGroup>
            {error && <Notice kind="error">{error}</Notice>}
            <Field label="服务地址" hint="本机试点默认地址为 http://127.0.0.1:17890">
              <Input
                required
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://organization.example.com"
              />
            </Field>
            <Field
              label="成员访问凭证"
              hint="协同服务凭证与模型 API Key 分开。桌面端使用系统凭证库保存。"
            >
              <Input
                required
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                placeholder="输入成员访问凭证"
              />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-end">
        <Button form="connection-form" type="submit" disabled={busy || !baseUrl || !token}>
          {busy ? '正在验证…' : '保存并连接'}
          <ArrowRight />
        </Button>
      </CardFooter>
    </Card>
  );
  if (standalone)
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-8">
        <div className="flex w-full max-w-lg flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">微梦 · 智能组织</h1>
              <p className="text-sm text-muted-foreground">项目协同工作台</p>
            </div>
          </div>
          {content}
          <p className="text-center text-sm text-muted-foreground">
            模型和 API 接入继续由 Codex / DeepSeek Harness 配置。
          </p>
        </div>
      </div>
    );
  return (
    <>
      <PageHeader title="连接设置" description="管理本机与组织协同服务的连接。" />
      <div className="flex flex-wrap items-start gap-6">
        {content}
        {me && (
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>当前身份</CardTitle>
              <CardDescription>组织内的成员身份与访问权限</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <PersonAvatar name={me.name} />
              <div>
                <p className="font-medium">{me.name}</p>
                <p className="text-sm text-muted-foreground">
                  {me.role === 'admin' ? '组织管理员' : '协作成员'}
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="secondary" onClick={onDisconnect}>
                <LogOut />
                断开连接
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </>
  );
}
