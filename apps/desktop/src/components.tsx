import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactNode, ReactElement, ComponentProps } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';
import { Button as UIButton } from '@/components/ui/button';
import { Badge as UIBadge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Field as UIField,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldSet,
} from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Empty as UIEmpty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Member } from './types';

export function Button({
  variant = 'primary',
  children,
  ...props
}: Omit<ComponentProps<typeof UIButton>, 'variant'> & {
  variant?:
    'primary' | 'secondary' | 'ghost' | 'danger' | 'default' | 'outline' | 'destructive' | 'link';
}) {
  const mapped =
    variant === 'primary'
      ? 'default'
      : variant === 'secondary'
        ? 'outline'
        : variant === 'danger'
          ? 'destructive'
          : variant;
  return (
    <UIButton type="button" variant={mapped} {...props}>
      {Children.map(children, (child) =>
        isValidElement(child) && typeof child.type !== 'string'
          ? cloneElement(child as ReactElement<any>, {
              'data-icon': 'inline-start',
              size: undefined,
            })
          : child,
      )}
    </UIButton>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <UIBadge
      variant={
        tone === 'mint'
          ? 'outline'
          : tone === 'amber'
            ? 'secondary'
            : tone === 'violet'
              ? 'default'
              : 'secondary'
      }
    >
      {children}
    </UIBadge>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <UIEmpty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {detail && <EmptyDescription>{detail}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </UIEmpty>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const child =
    Children.count(children) === 1 && isValidElement(children)
      ? (children as ReactElement<any>)
      : null;
  return (
    <UIField data-disabled={child?.props.disabled || undefined}>
      <FieldLabel htmlFor={child?.props.id || id}>{label}</FieldLabel>
      {child ? cloneElement(child, { id: child.props.id || id }) : children}
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </UIField>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={cn('max-h-[88vh] overflow-y-auto', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle || '请确认信息后保存。'}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function MemberSelect({
  members,
  value,
  onChange,
  label = '选择成员',
  allowEmpty = true,
}: {
  members: Member[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
  allowEmpty?: boolean;
}) {
  return (
    <NativeSelect
      aria-label={label}
      className="w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty && <NativeSelectOption value="">未分配</NativeSelectOption>}
      {members
        .filter((m) => m.active)
        .map((m) => (
          <NativeSelectOption key={m.id} value={m.id}>
            {m.name}
            {m.role === 'admin' ? ' · 管理员' : ''}
          </NativeSelectOption>
        ))}
    </NativeSelect>
  );
}
export function MemberChecks({
  members,
  values,
  onChange,
}: {
  members: Member[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const base = useId();
  return (
    <FieldSet>
      <FieldGroup className="flex-row flex-wrap gap-4">
        {members
          .filter((m) => m.active)
          .map((m) => (
            <UIField key={m.id} orientation="horizontal" className="w-auto">
              <Checkbox
                id={`${base}-${m.id}`}
                checked={values.includes(m.id)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...values, m.id] : values.filter((id) => id !== m.id))
                }
              />
              <FieldLabel htmlFor={`${base}-${m.id}`}>{m.name}</FieldLabel>
            </UIField>
          ))}
      </FieldGroup>
    </FieldSet>
  );
}
export function Loading({ label = '正在同步项目…' }: { label?: string }) {
  return (
    <div className="flex flex-col gap-6 p-8">
      <p className="text-muted-foreground">{label}</p>
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
export function Notice({
  children,
  kind = 'info',
}: {
  children: ReactNode;
  kind?: 'info' | 'error' | 'success';
}) {
  return (
    <Alert variant={kind === 'error' ? 'destructive' : 'default'}>
      <AlertCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
export function PersonAvatar({
  name,
  size = 'default',
}: {
  name: string;
  size?: 'default' | 'sm';
}) {
  return (
    <Avatar size={size}>
      <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
}
