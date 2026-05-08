import { ClipboardList, Clock3 } from 'lucide-react';
import type { ChangeSummary } from '../../../../main/lib/openspec/types';
import { cn } from '../../../lib/utils';
import { formatTimeAgo } from '../utils/format-time-ago';

function getSpecTitle(change: ChangeSummary): string {
  return change.proposal?.title || change.changeId;
}

function getSpecSummary(change: ChangeSummary): string {
  return change.proposal?.why || 'Continue working from this OpenSpec change.';
}

function getSpecAuthor(change: ChangeSummary): string | null {
  const author = change.proposal?.attributes?.author;
  return typeof author === 'string' && author.trim().length > 0 ? author.trim() : null;
}

interface SpecCardProps {
  change: ChangeSummary;
  selected: boolean;
  onClick: (change: ChangeSummary) => void;
}

export function SpecCard({ change, selected, onClick }: SpecCardProps) {
  const author = getSpecAuthor(change);

  return (
    <button
      type="button"
      onClick={() => onClick(change)}
      className={cn(
        'flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-[border-color,background-color,box-shadow] duration-150',
        'hover:border-foreground/20 hover:bg-accent/30',
        selected && 'border-primary bg-accent/40 ring-1 ring-primary'
      )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="min-w-0 truncate text-sm font-medium text-foreground">{getSpecTitle(change)}</div>
        </div>
        <div
          className={cn(
            'shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground',
            selected && 'border-primary/40 text-primary'
          )}>
          OpenSpec
        </div>
      </div>

      <div className="line-clamp-3 text-sm leading-5 text-muted-foreground">{getSpecSummary(change)}</div>

      <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{formatTimeAgo(change.modifiedAt)}</span>
        {author && <span className="truncate">@{author}</span>}
      </div>
    </button>
  );
}
