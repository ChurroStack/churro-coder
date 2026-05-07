import { forwardRef } from 'react';
import { ChevronDown, Loader2, MoreVertical } from 'lucide-react';
import { ProjectIcon } from '../../../components/ui/project-icon';
import { cn } from '../../../lib/utils';
import type { GroupedProject } from '../grouping/use-grouped-agent-chats';

export function ProjectGroupHeader({
  group,
  isOpen,
  count,
  menu,
  onToggle
}: {
  group: GroupedProject;
  isOpen: boolean;
  count: number;
  menu?: React.ReactNode;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
        <ChevronDown className={cn('size-3.5 flex-shrink-0 transition-transform', !isOpen && '-rotate-90')} />
        <ProjectIcon project={group.project} className="size-4" />
        <span className="truncate text-sm font-medium text-foreground">{group.displayName}</span>
        <ProjectGroupStatus status={group.status} />
        <span className="ml-auto flex-shrink-0 text-xs text-muted-foreground/80">{count}</span>
      </button>
      {menu ?? null}
    </div>
  );
}

function ProjectGroupStatus({ status }: { status: GroupedProject['status'] }) {
  if (status === 'pendingQuestion') {
    return (
      <span
        data-testid="project-status-pendingQuestion"
        className="flex size-3 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-[9px] font-semibold text-white">
        ?
      </span>
    );
  }

  if (status === 'loading') {
    return (
      <Loader2
        data-testid="project-status-loading"
        className="size-3 flex-shrink-0 animate-spin text-muted-foreground/80"
      />
    );
  }

  if (status === 'pendingPlan') {
    return (
      <span data-testid="project-status-pendingPlan" className="size-1.5 flex-shrink-0 rounded-full bg-amber-500" />
    );
  }

  if (status === 'unseen') {
    return <span data-testid="project-status-unseen" className="size-1.5 flex-shrink-0 rounded-full bg-blue-500" />;
  }

  return null;
}

export const ProjectGroupMenuButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function ProjectGroupMenuButton({ className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Project actions"
        className={cn(
          'rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground',
          className
        )}
        {...props}>
        <MoreVertical className="size-3.5" />
      </button>
    );
  }
);
