import { useAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { newProjectDraftAtom } from './atoms';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw } from 'lucide-react';

const STALE_TIME = 5 * 60 * 1000;

export function AzureProjectPicker() {
  const [draft, setDraft] = useAtom(newProjectDraftAtom);
  const utils = trpc.useUtils();

  const { data: projects, isFetching } = trpc.newProject.listProjects.useQuery(
    { provider: 'azure', accountId: draft.accountId },
    { staleTime: STALE_TIME, enabled: draft.provider === 'azure' && !!draft.accountId }
  );

  if (draft.provider !== 'azure' || !draft.accountId) return null;
  if (!projects || projects.length === 0) return null;

  const handleRefresh = () => {
    utils.newProject.listProjects.invalidate({ provider: 'azure', accountId: draft.accountId });
  };

  return (
    <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <Select value={draft.projectId ?? ''} onValueChange={(v) => setDraft((d) => ({ ...d, projectId: v }))}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select project…" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.name}>
              {p.name}
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
