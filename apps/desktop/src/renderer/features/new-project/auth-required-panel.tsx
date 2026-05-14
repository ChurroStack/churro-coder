import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
type ProviderId = 'github' | 'azure' | 'local';

interface Props {
  provider: ProviderId;
}

const AUTH_COMMANDS: Record<ProviderId, string> = {
  github: 'gh auth login',
  azure: 'az login',
  local: ''
};

export function AuthRequiredPanel({ provider }: Props) {
  const utils = trpc.useUtils();

  const { data, isFetching } = trpc.newProject.checkAuth.useQuery(
    { provider, evictCache: false },
    { staleTime: 60_000 }
  );

  const handleRetry = () => {
    utils.newProject.checkAuth.invalidate({ provider, evictCache: false });
  };

  if (!data || data.ok) return null;

  const cmd = AUTH_COMMANDS[provider];

  return (
    <div
      className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 space-y-3"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Authentication required</p>
      {cmd && (
        <p className="font-mono text-xs">
          Run <code className="rounded bg-background px-1 py-0.5">{cmd}</code> in your terminal, then click Retry.
        </p>
      )}
      {'hint' in data && data.hint && <p className="text-xs text-muted-foreground">{data.hint}</p>}
      <Button variant="outline" size="sm" onClick={handleRetry} disabled={isFetching} className="gap-2">
        <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
        Retry
      </Button>
    </div>
  );
}
