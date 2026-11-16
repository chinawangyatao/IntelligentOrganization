import { Children, Fragment, isValidElement } from 'react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type AppSelectOptionProps = {
  value: string;
  children: ReactNode;
  disabled?: boolean;
};

type AppSelectProps = Omit<
  ComponentProps<typeof SelectTrigger>,
  'value' | 'defaultValue' | 'onChange' | 'children'
> & {
  value: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  required?: boolean;
  name?: string;
  placeholder?: ReactNode;
};

// Radix items reserve the empty string for a cleared value. The marker item
// lets users explicitly choose an empty domain value while the controlled root
// stays empty, so required form controls still participate in native validation.
const EMPTY_ITEM = '__intelligent_organization_empty_selection__';

function collectOptions(children: ReactNode): ReactElement<AppSelectOptionProps>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<AppSelectOptionProps>(child)) return [];
    if (child.type === Fragment) return collectOptions(child.props.children);
    return child.type === AppSelectOption ? [child] : [];
  });
}

export function AppSelect({
  value,
  onValueChange,
  children,
  required,
  name,
  disabled,
  placeholder,
  className,
  ...triggerProps
}: AppSelectProps) {
  const options = collectOptions(children);
  const emptyOption = options.find((option) => option.props.value === '');
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onValueChange?.(nextValue === EMPTY_ITEM ? '' : nextValue)}
      required={required}
      name={name}
      disabled={disabled}
    >
      <SelectTrigger
        {...triggerProps}
        disabled={disabled}
        aria-required={required || undefined}
        className={cn('w-full', className)}
      >
        <SelectValue placeholder={placeholder ?? emptyOption?.props.children ?? '请选择'} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.props.value || EMPTY_ITEM}
              value={option.props.value || EMPTY_ITEM}
              disabled={option.props.disabled}
            >
              {option.props.children}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function AppSelectOption(_props: AppSelectOptionProps) {
  return null;
}
