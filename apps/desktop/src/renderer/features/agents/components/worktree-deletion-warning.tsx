import { AlertTriangle } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface Props {
  worktreePath: string | null;
}

export function WorktreeDeletionWarning({ worktreePath }: Props) {
  const { data, isError } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath, staleTime: 30000 }
  );

  if (!worktreePath || isError || !data) return null;

  const changedFilesCount =
    (data.staged?.length ?? 0) + (data.unstaged?.length ?? 0) + (data.untracked?.length ?? 0);
  const pushCount = data.hasUpstream ? data.pushCount : 0;
  if (changedFilesCount === 0 && pushCount === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" />
        Pending work will be lost
      </div>
      <ul className="mt-2 ml-6 list-disc text-foreground/80">
        {changedFilesCount > 0 && (
          <li>
            {changedFilesCount} uncommitted file{changedFilesCount === 1 ? '' : 's'}
          </li>
        )}
        {pushCount > 0 && (
          <li>
            {pushCount} unpushed commit{pushCount === 1 ? '' : 's'}
          </li>
        )}
      </ul>
    </div>
  );
}
