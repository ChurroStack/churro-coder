import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

interface WizardSectionProps {
  step: number;
  label: string;
  children: ReactNode;
  className?: string;
}

export function WizardSection({ step, label, children, className }: WizardSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground">
          {step}
        </div>
        <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      </div>
      {children}
    </section>
  );
}
