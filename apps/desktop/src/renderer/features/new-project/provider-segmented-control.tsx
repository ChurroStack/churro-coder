import { useAtom } from 'jotai';
import { newProjectDraftAtom } from './atoms';
import { cn } from '@/lib/utils';

const PROVIDERS = [
  { id: 'github' as const, label: 'GitHub' },
  { id: 'azure' as const, label: 'Azure DevOps' },
  { id: 'local' as const, label: 'Local' }
];

export function ProviderSegmentedControl() {
  const [draft, setDraft] = useAtom(newProjectDraftAtom);

  return (
    <div
      className="inline-flex rounded-md border border-border bg-muted p-0.5"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {PROVIDERS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setDraft((d) => ({ ...d, provider: id, accountId: '', projectId: undefined }))}
          className={cn(
            'rounded px-3 py-1.5 text-sm font-medium transition-colors',
            draft.provider === id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}>
          {label}
        </button>
      ))}
    </div>
  );
}
