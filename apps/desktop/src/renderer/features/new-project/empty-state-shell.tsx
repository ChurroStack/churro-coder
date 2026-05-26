import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { newProjectDialogOpenAtom } from './atoms';
import { NewProjectDialog } from './new-project-dialog';

/** Full-screen shell shown when no project is selected. Opens NewProjectDialog inline. */
export function EmptyStateShell() {
  const setOpen = useSetAtom(newProjectDialogOpenAtom);

  useEffect(() => {
    setOpen(true);
  }, [setOpen]);

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <NewProjectDialog forceOpen />
    </div>
  );
}
