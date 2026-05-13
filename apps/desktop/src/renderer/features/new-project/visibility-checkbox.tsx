import { useAtom } from 'jotai';
import { newProjectDraftAtom } from './atoms';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export function VisibilityCheckbox() {
  const [draft, setDraft] = useAtom(newProjectDraftAtom);

  if (draft.provider !== 'github') return null;

  const isPublic = draft.visibility === 'public';

  return (
    <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <Checkbox
        id="visibility-public"
        checked={isPublic}
        onCheckedChange={(checked) => setDraft((d) => ({ ...d, visibility: checked ? 'public' : undefined }))}
      />
      <Label htmlFor="visibility-public" className="text-sm font-normal">
        Make repository public
      </Label>
    </div>
  );
}
