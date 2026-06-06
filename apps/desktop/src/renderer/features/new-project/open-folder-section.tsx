import { useSetAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { newProjectDialogOpenAtom } from './atoms';
import { useApplyAddedProject } from './use-apply-added-project';
import { Button } from '@/components/ui/button';
import { FolderOpen, Loader2 } from 'lucide-react';

export function OpenFolderSection() {
  const setDialogOpen = useSetAtom(newProjectDialogOpenAtom);
  const applyAddedProject = useApplyAddedProject();

  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      // `project` is null when the user cancels the native picker — closing the
      // dialog then would strand the forced empty-state on a blank screen.
      if (project) {
        applyAddedProject(project);
        setDialogOpen(false);
      }
    }
  });

  return (
    <div
      className="flex flex-col items-center gap-4 py-8"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        Open an existing local folder that already contains your code.
      </p>
      <Button variant="outline" onClick={() => openFolder.mutate()} disabled={openFolder.isPending} className="gap-2">
        {openFolder.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
        Select folder
      </Button>
    </div>
  );
}
