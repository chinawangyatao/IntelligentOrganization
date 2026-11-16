import { CheckCircle2, Monitor, Moon, Palette, RotateCcw, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components';
import { appearanceColors, useAppearance } from '../AppearanceProvider';
import type { AppearanceColor, AppearanceMode } from '../AppearanceProvider';
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
} from '@/components/ui/card';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const modes: { value: AppearanceMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

export default function SystemSettings() {
  const appearance = useAppearance();
  const modeLabel = modes.find((item) => item.value === appearance.mode)!.label;
  const colorLabel = appearanceColors.find((item) => item.value === appearance.color)!.label;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="系统设置" description="调整这台设备的应用外观，切换后立即生效。" />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>外观与主题</CardTitle>
            <CardDescription>选择显示模式和主色，设置会自动保存在本机。</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldContent>
                  <FieldTitle id="appearance-mode-label">显示模式</FieldTitle>
                  <FieldDescription>
                    跟随系统时，会随设备的浅色或深色设置自动变化。
                  </FieldDescription>
                </FieldContent>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={appearance.mode}
                  aria-labelledby="appearance-mode-label"
                  className="flex-wrap"
                  onValueChange={(value) => {
                    if (value) appearance.setMode(value as AppearanceMode);
                  }}
                >
                  {modes.map((item) => (
                    <ToggleGroupItem key={item.value} value={item.value}>
                      <item.icon data-icon="inline-start" />
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Separator />
              <Field>
                <FieldContent>
                  <FieldTitle id="appearance-color-label">主题主色</FieldTitle>
                  <FieldDescription>
                    应用到主要操作、焦点和侧栏标识，内容区域保持清晰的中性色。
                  </FieldDescription>
                </FieldContent>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={appearance.color}
                  aria-labelledby="appearance-color-label"
                  className="flex-wrap"
                  onValueChange={(value) => {
                    if (value) appearance.setColor(value as AppearanceColor);
                  }}
                >
                  {appearanceColors.map((item) => (
                    <ToggleGroupItem key={item.value} value={item.value}>
                      <span
                        aria-hidden="true"
                        className="theme-color-swatch size-3 shrink-0 rounded-full"
                        data-color={item.value}
                      />
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex-wrap justify-between gap-3">
            <span role="status" className="text-sm text-muted-foreground">
              {appearance.saveState === 'saved'
                ? '外观设置已保存到本机'
                : appearance.saveState === 'error'
                  ? '当前外观尚未成功保存'
                  : '选择外观后自动保存到本机'}
            </span>
            <Button variant="outline" onClick={appearance.resetAppearance}>
              <RotateCcw data-icon="inline-start" />
              恢复默认
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>组件预览</CardTitle>
            <CardDescription>查看当前主题下的按钮、标记和通知效果。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{colorLabel}主色</Badge>
              <Badge variant="secondary">{modeLabel}</Badge>
              <Badge variant="outline">
                当前为{appearance.resolvedTheme === 'dark' ? '深色' : '浅色'}
              </Badge>
            </div>
            <Alert>
              <Palette />
              <AlertTitle>当前外观已应用</AlertTitle>
              <AlertDescription>项目数据和协作内容不受外观设置影响。</AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button
              onClick={() =>
                toast.success('主题通知预览', {
                  description: '这是一条本机预览通知，用于查看当前主题的显示效果。',
                })
              }
            >
              <CheckCircle2 data-icon="inline-start" />
              预览通知
            </Button>
          </CardFooter>
        </Card>
      </div>
      {appearance.storageError && (
        <Alert variant="destructive">
          <AlertTitle>外观保存提示</AlertTitle>
          <AlertDescription>
            {appearance.storageError}
            <div>
              <Button variant="outline" size="sm" onClick={appearance.retrySave}>
                重试保存
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
