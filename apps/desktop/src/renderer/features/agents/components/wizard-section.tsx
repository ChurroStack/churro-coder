import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

interface WizardSectionProps {
  step: number;
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function WizardSection({ step, label, description, children, className }: WizardSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground">
          {step}
        </div>
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground leading-7">
            {label}
          </div>
          {description && <p className="mt-0.5 text-xs text-muted-foreground/70 leading-relaxed">{description}</p>}
        </div>
      </div>
      <div className="pl-[40px]">{children}</div>
    </section>
  );
}
