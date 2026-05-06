import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface Props {
  worktreePath: string | null;
}

export function WorktreeDeletionWarning({ worktreePath }: Props) {
  const { data, isError, error } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath ?? '' },
    { enabled: !!worktreePath, staleTime: 30000 }
  );

  // The query throws when the worktree isn't registered with the main-process
  // SecureFs registry — typical for archived workspaces in a fresh app session.
  // Swallowing it silently means a workspace with real pending work would show
  // no warning, defeating the purpose of this component. Log loudly so the
  // failure mode is visible during dev.
  useEffect(() => {
    if (isError && worktreePath) {
      console.warn(
        '[WorktreeDeletionWarning] getStatus failed for worktreePath',
        worktreePath,
        '— pending-work warning will not be shown.',
        error?.message
      );
    }
  }, [isError, worktreePath, error?.message]);

  if (!worktreePath || isError || !data) return null;

  const changedFilesCount = (data.staged?.length ?? 0) + (data.unstaged?.length ?? 0) + (data.untracked?.length ?? 0);
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
