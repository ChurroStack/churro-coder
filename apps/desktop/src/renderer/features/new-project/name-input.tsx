import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { newProjectDraftAtom } from './atoms';
import { Input } from '@/components/ui/input';
import { validateRepoName } from './lib/validate-name';
import { cn } from '@/lib/utils';

interface NameInputProps {
  onFocus?: () => void;
  onBlur?: () => void;
}

export function NameInput({ onFocus, onBlur }: NameInputProps = {}) {
  const [draft, setDraft] = useAtom(newProjectDraftAtom);
  const [debouncedName, setDebouncedName] = useState(draft.name);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(draft.name), 400);
    return () => clearTimeout(t);
  }, [draft.name]);

  const localError = draft.name ? validateRepoName(draft.name, draft.provider) : undefined;

  const { data: serverCheck } = trpc.newProject.validateName.useQuery(
    {
      provider: draft.provider as 'github' | 'azure' | 'local',
      accountId: draft.accountId,
      projectId: draft.projectId,
      name: debouncedName
    },
    {
      enabled: !!debouncedName && (!localError || localError.valid),
      staleTime: 30_000
    }
  );

  const error =
    localError && !localError.valid
      ? localError.error
      : serverCheck && !serverCheck.valid
        ? serverCheck.error
        : undefined;

  return (
    <div className="space-y-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <Input
        placeholder="my-awesome-project"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(error ? 'border-destructive focus-visible:ring-destructive' : '')}
        maxLength={100}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
