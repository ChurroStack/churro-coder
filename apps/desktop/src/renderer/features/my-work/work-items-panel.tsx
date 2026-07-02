import { useMemo, useState } from 'react';
import { CircleDot, ExternalLink } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import { resolveWorkItemInsertText } from '../mentions/providers/work-items-provider';
import type { WorkItem } from '../../../main/lib/work-items/types';

interface WorkItemsPanelProps {
  onInsert: (text: string) => void;
  projectId?: string;
}

export function WorkItemsPanel({ onInsert, projectId }: WorkItemsPanelProps) {
  const { data, isLoading } = trpc.workItems.list.useQuery(projectId ? { projectId } : undefined, {
    staleTime: 60_000,
    gcTime: 120_000
  });

  const items = useMemo(() => (data?.items ?? []).filter((i) => i.provider === 'github').slice(0, 30), [data?.items]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">Loading issues…</div>;
  }

  if (!items.length) {
    return (
      <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
        {data?.error ? data.error.message : 'No open issues assigned to you.'}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto max-h-48 divide-y divide-border/40">
      {items.map((item) => (
        <WorkItemPanelRow key={item.id} item={item} onInsert={onInsert} />
      ))}
    </div>
  );
}

function WorkItemPanelRow({ item, onInsert }: { item: WorkItem; onInsert: (text: string) => void }) {
  const updatedAgo = formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true });
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="group flex items-start gap-2 px-3 py-2 hover:bg-muted/50 transition-colors duration-100">
      <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
      <button
        type="button"
        aria-label={`Insert reference to issue #${item.number}: ${item.title}`}
        disabled={isLoading}
        onClick={async () => {
          setIsLoading(true);
          try {
            onInsert(await resolveWorkItemInsertText(item));
          } finally {
            setIsLoading(false);
          }
        }}
        className="flex-1 min-w-0 text-left">
        <p className="text-xs font-medium text-foreground truncate leading-snug">{item.title}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {item.repoOwner}/{item.repoName} #{item.number} · {isLoading ? 'Loading details…' : updatedAgo}
        </p>
      </button>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open issue #${item.number} on GitHub`}
        className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
      </a>
    </div>
  );
}
