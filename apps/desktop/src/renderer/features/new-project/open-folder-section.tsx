import { useSetAtom } from 'jotai';
import { trpc } from '@/lib/trpc';
import { selectedProjectAtom, selectedAgentChatIdAtom } from '@/lib/atoms';
import { newProjectDialogOpenAtom } from './atoms';
import { Button } from '@/components/ui/button';
import { FolderOpen, Loader2 } from 'lucide-react';

export function OpenFolderSection() {
  const setDialogOpen = useSetAtom(newProjectDialogOpenAtom);
  const setSelectedProject = useSetAtom(selectedProjectAtom);
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);

  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (project) {
        setSelectedProject({ id: project.id, name: project.name, path: project.path });
      }
      setDialogOpen(false);
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
