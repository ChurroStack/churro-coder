import type { ComponentType, SVGProps } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
}

interface RadioCardGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: RadioCardOption<T>[];
  columns?: 2 | 3;
}

export function RadioCardGroup<T extends string>({ value, onChange, options, columns = 3 }: RadioCardGroupProps<T>) {
  return (
    <div role="radiogroup" className={cn('grid gap-3', columns === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3')}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-selected={selected ? 'true' : 'false'}
            className={cn(
              'group relative flex min-h-[112px] flex-col gap-3 rounded-md border border-border bg-card px-4 py-4 text-left transition-[border-color,background-color,box-shadow] duration-150',
              'hover:border-foreground/20 hover:bg-accent/30',
              selected && 'border-primary bg-accent/40 ring-1 ring-primary'
            )}
            onClick={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors',
                    selected && 'border-primary bg-primary text-primary-foreground'
                  )}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 text-sm font-medium text-foreground">{option.label}</div>
              </div>
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-transparent transition-colors',
                  selected && 'border-primary bg-primary text-primary-foreground'
                )}>
                <Check className="h-3 w-3" />
              </div>
            </div>
            <div className="text-sm leading-5 text-muted-foreground">{option.description}</div>
          </button>
        );
      })}
    </div>
  );
}
