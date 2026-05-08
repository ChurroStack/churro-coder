import type { ComponentType, SVGProps } from 'react';
import { cn } from '../../../lib/utils';

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

export interface AgentModeOption<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: IconComponent;
  detailTitle: string;
  detailDescription: string;
}

interface AgentModeSelectorProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly AgentModeOption<T>[];
}

export function AgentModeSelector<T extends string>({ value, onChange, options }: AgentModeSelectorProps<T>) {
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const DetailIcon = selectedOption.icon;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Agent mode"
        className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted/40 p-1">
        {options.map((option) => {
          const Icon = option.icon;
          const selected = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`agent-mode-panel-${option.value}`}
              data-state={selected ? 'active' : 'inactive'}
              className={cn(
                'inline-flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm transition-[background-color,color,box-shadow] duration-150',
                selected
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
              )}
              onClick={() => {
                if (!selected) {
                  onChange(option.value);
                }
              }}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate font-medium">{option.label}</span>
            </button>
          );
        })}
      </div>

      <div
        id={`agent-mode-panel-${selectedOption.value}`}
        role="tabpanel"
        className="flex items-start gap-4 rounded-md border border-border bg-card px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          <DetailIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{selectedOption.detailTitle}</div>
          <div className="text-sm leading-6 text-muted-foreground">{selectedOption.detailDescription}</div>
        </div>
      </div>
    </div>
  );
}
