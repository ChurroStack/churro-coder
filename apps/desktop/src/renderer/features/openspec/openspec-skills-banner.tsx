import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc';
import { Button } from '../../components/ui/button';

interface OpenspecSkillsBannerProps {
  chatId: string;
}

/**
 * Non-blocking banner shown inside the workspace OpenSpec panel when the
 * workspace was initialized by the old manual init (no AGENTS.md) or when
 * selected tool sentinels are missing.
 *
 * Mounting point: render above the OpenSpecChangeView when openspecState
 * returns 'partial-legacy' or 'tools-missing'.
 */
export function OpenspecSkillsBanner({ chatId }: OpenspecSkillsBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const { data: stateData, isLoading } = trpc.chats.openspecState.useQuery({ chatId }, { staleTime: 30_000 });

  const utils = trpc.useUtils();

  const initMutation = trpc.chats.openspecInstallTools.useMutation({
    onSuccess: () => {
      toast.success('OpenSpec CLI skills installed successfully.');
      void utils.chats.openspecState.invalidate({ chatId });
      setDismissed(true);
    },
    onError: (err) => {
      toast.error(err.message ?? 'Failed to install OpenSpec skills.');
    }
  });

  const upgradeMutation = trpc.chats.openspecInit.useMutation({
    onSuccess: () => {
      toast.success('OpenSpec workspace upgraded to bundled CLI.');
      void utils.chats.openspecState.invalidate({ chatId });
      setDismissed(true);
    },
    onError: (err) => {
      toast.error(err.message ?? 'Failed to upgrade OpenSpec workspace.');
    }
  });

  if (isLoading || dismissed || !stateData) return null;
  const { state, missingTools } = stateData;
  if (state === 'ok' || state === 'uninitialized') return null;

  const isPending = initMutation.isPending || upgradeMutation.isPending;

  const handleAction = () => {
    if (state === 'partial-legacy') {
      upgradeMutation.mutate({ chatId, force: true });
    } else {
      // tools-missing
      const tools = missingTools as ('claude' | 'codex')[];
      initMutation.mutate({ chatId, tools });
    }
  };

  const label =
    state === 'partial-legacy' ? 'Upgrade to bundled OpenSpec CLI' : `Install OpenSpec for ${missingTools.join(', ')}`;

  const description =
    state === 'partial-legacy'
      ? 'This workspace was initialized without the bundled CLI. Upgrade to install Claude/Codex skills and keep your specs in sync.'
      : `Some tool skills are missing. Install them so ${missingTools.join(' and ')} can use OpenSpec commands outside Churro Coder.`;

  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-amber-700 dark:text-amber-400">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" disabled={isPending} onClick={handleAction}>
          {isPending ? 'Installing…' : label}
        </Button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setDismissed(true)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
