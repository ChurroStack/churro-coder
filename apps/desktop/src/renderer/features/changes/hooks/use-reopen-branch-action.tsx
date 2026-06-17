import { useCallback, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { trpc } from '@/lib/trpc';

interface UseReopenBranchActionOptions {
  worktreePath?: string | null;
  onSuccess?: () => void;
}

/**
 * "Re-open branch" flow for a workspace whose remote branch is `[gone]` (PR
 * merged + remote branch deleted). Always confirms first via an AlertDialog
 * that recommends starting a fresh workspace instead. On confirm it:
 *   1. `git push` (setUpstream) — recreates the deleted remote branch.
 *   2. `mergeFromDefault` — merges `origin/<base>` back in (update from main).
 *
 * Pure git ops via tRPC, so it behaves identically across built-in, Claude CLI,
 * and Codex CLI harnesses. Mirrors the dialog-returning shape of
 * {@link usePushAction}.
 */
export function useReopenBranchAction({ worktreePath, onSuccess }: UseReopenBranchActionOptions) {
  const [open, setOpen] = useState(false);
  const pushMutation = trpc.changes.push.useMutation();
  const mergeMutation = trpc.changes.mergeFromDefault.useMutation();
  const isPending = pushMutation.isPending || mergeMutation.isPending;

  const reopen = useCallback(() => setOpen(true), []);

  const confirm = useCallback(async () => {
    if (!worktreePath) {
      toast.error('Worktree path is required');
      setOpen(false);
      return;
    }
    try {
      // Recreate the deleted remote branch (force --set-upstream so a `[gone]`
      // upstream is rebound, not just plain-pushed).
      await pushMutation.mutateAsync({ worktreePath, setUpstream: true });
      // Update from base — merge origin/<base> back into the re-opened branch.
      await mergeMutation.mutateAsync({ worktreePath });
      console.log(`[reopen-branch] re-opened + updated from base worktree=${worktreePath}`);
      toast.success('Branch re-opened and updated from base');
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The push may have already recreated the remote branch even if the merge
      // failed (e.g. conflicts / dirty tree) — the normal "Update from base"
      // flow can finish it. Log the partial state (push may have succeeded) so
      // it's reconstructable, and surface the failure.
      console.error(`[reopen-branch] failed worktree=${worktreePath}:`, message);
      toast.error(`Re-open failed: ${message}`);
    } finally {
      setOpen(false);
    }
  }, [worktreePath, pushMutation, mergeMutation, onSuccess]);

  const dialog: ReactNode = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-open this branch?</AlertDialogTitle>
          <AlertDialogDescription>
            This branch&apos;s work has already been merged. It&apos;s usually better to start a new workspace and
            archive this one. If you re-open, the branch is pushed back to origin and the latest changes from the base
            branch are merged in — which can produce messy history. Continue only if you intend to keep working on this
            branch.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog mounted while the async work runs; close in confirm().
              e.preventDefault();
              void confirm();
            }}
            disabled={isPending}>
            {isPending ? 'Re-opening…' : 'Re-open'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { reopen, isPending, dialog };
}
