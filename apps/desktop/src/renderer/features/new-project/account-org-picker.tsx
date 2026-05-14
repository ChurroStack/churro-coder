import { useAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { newProjectDraftAtom } from './atoms';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { RefreshCw } from 'lucide-react';

const STALE_TIME = 5 * 60 * 1000;

export function AccountOrgPicker() {
  const [draft, setDraft] = useAtom(newProjectDraftAtom);
  const utils = trpc.useUtils();

  const { data: accounts = [], isFetching } = trpc.newProject.listAccounts.useQuery(
    { provider: draft.provider as 'github' | 'azure' | 'local' },
    { staleTime: STALE_TIME, enabled: draft.provider !== 'local' }
  );

  if (draft.provider === 'local') return null;

  const handleRefresh = () => {
    utils.newProject.listAccounts.invalidate({ provider: draft.provider as 'github' | 'azure' | 'local' });
  };

  if (draft.provider === 'github') {
    return (
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Select value={draft.accountId} onValueChange={(v) => setDraft((d) => ({ ...d, accountId: v }))}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select account…" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label}
                {a.badge ? <span className="ml-2 text-xs text-muted-foreground">({a.badge})</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    );
  }

  // Azure DevOps: combobox + manual URL entry
  return (
    <div className="space-y-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {accounts.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            value={draft.accountId}
            onValueChange={(v) => setDraft((d) => ({ ...d, accountId: v, projectId: undefined }))}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select org…" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      )}
      <Input
        placeholder="https://dev.azure.com/my-org"
        value={draft.accountId}
        onChange={(e) => setDraft((d) => ({ ...d, accountId: e.target.value, projectId: undefined }))}
      />
      <p className="text-xs text-muted-foreground">Enter your Azure DevOps org URL directly if not listed above.</p>
    </div>
  );
}
