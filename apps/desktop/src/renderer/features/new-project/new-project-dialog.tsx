import { useAtom, useSetAtom } from 'jotai';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { newProjectDialogOpenAtom, newProjectActiveSectionAtom } from './atoms';
import { useResetNewProjectDraft } from './use-reset-new-project-draft';
import { CreateProjectWizard } from './create-project-wizard';
import { OpenFolderSection } from './open-folder-section';
import { CloneRepoSection } from './clone-repo-section';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'create' as const, label: 'Create' },
  { id: 'open' as const, label: 'Open' },
  { id: 'clone' as const, label: 'Clone' }
];

export function NewProjectDialog({ forceOpen = false }: { forceOpen?: boolean } = {}) {
  const [open, setOpen] = useAtom(newProjectDialogOpenAtom);
  const [activeSection, setActiveSection] = useAtom(newProjectActiveSectionAtom);
  const resetDraft = useResetNewProjectDraft();

  const handleOpenChange = (o: boolean) => {
    if (forceOpen && !o) return;
    setOpen(o);
    if (!o) resetDraft();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[1050px] max-h-[90vh] overflow-y-auto"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        showCloseButton={!forceOpen}
        onEscapeKeyDown={forceOpen ? (e) => e.preventDefault() : undefined}
        onPointerDownOutside={forceOpen ? (e) => e.preventDefault() : undefined}
        onInteractOutside={forceOpen ? (e) => e.preventDefault() : undefined}>
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
        </DialogHeader>

        {/* Section switcher */}
        <div className="flex gap-1 border-b border-border pb-2">
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                activeSection === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}>
              {label}
            </button>
          ))}
        </div>

        <div className="pt-2">
          {activeSection === 'create' && <CreateProjectWizard />}
          {activeSection === 'open' && <OpenFolderSection />}
          {activeSection === 'clone' && <CloneRepoSection />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
