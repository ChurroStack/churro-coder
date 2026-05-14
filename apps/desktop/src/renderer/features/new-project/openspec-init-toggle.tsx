import { useAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { newProjectDraftAtom } from './atoms';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

export function OpenspecInitToggle() {
  const [draft, setDraft] = useAtom(newProjectDraftAtom);
  const utils = trpc.useUtils();

  const { data, isFetching } = trpc.newProject.detectCli.useQuery(
    { provider: 'openspec', evictCache: false },
    { staleTime: 60_000 }
  );

  const available = data?.available ?? false;

  const handleRecheck = () => {
    utils.newProject.detectCli.invalidate({ provider: 'openspec', evictCache: false });
  };

  return (
    <div className="space-y-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <Switch
          id="openspec-init"
          checked={draft.openspecInit}
          disabled={!available}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, openspecInit: v }))}
        />
        <Label htmlFor="openspec-init" className={available ? '' : 'text-muted-foreground'}>
          Initialize OpenSpec
        </Label>
        {!available && (
          <Button variant="ghost" size="sm" onClick={handleRecheck} disabled={isFetching} className="gap-1 text-xs">
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
            Recheck
          </Button>
        )}
      </div>
      {!available && (
        <p className="text-xs text-muted-foreground">OpenSpec binary not found. Install it to enable this option.</p>
      )}
    </div>
  );
}
