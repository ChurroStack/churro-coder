import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
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
  const [isRetrying, setIsRetrying] = useState(false);

  const { data, isFetching } = trpc.newProject.checkAuth.useQuery(
    { provider, evictCache: false },
    { staleTime: 60_000 }
  );

  // The displayed query uses `evictCache:false` so the 60 s main-process cache is honored on
  // initial load. On manual Retry we MUST evict that cache or `gh auth status` is not actually
  // re-run — so do an imperative fetch with `evictCache:true` and push the fresh result into
  // the displayed query's cache slot. Plain `invalidate()` would refetch with the displayed
  // key (`evictCache:false`) and the backend would just return its cached negative result.
  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const fresh = await utils.newProject.checkAuth.fetch({ provider, evictCache: true });
      utils.newProject.checkAuth.setData({ provider, evictCache: false }, fresh);
    } catch (err) {
      console.warn('[AuthRequiredPanel] retry failed', err);
    } finally {
      setIsRetrying(false);
    }
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
      <Button variant="outline" size="sm" onClick={handleRetry} disabled={isFetching || isRetrying} className="gap-2">
        <RefreshCw className={`h-3 w-3 ${isFetching || isRetrying ? 'animate-spin' : ''}`} />
        Retry
      </Button>
    </div>
  );
}
