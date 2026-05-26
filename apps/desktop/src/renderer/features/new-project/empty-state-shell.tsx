import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { newProjectDialogOpenAtom, newProjectDialogForceOpenAtom } from './atoms';

/**
 * Full-screen shell shown when no project is selected. Opens NewProjectDialogGlobal
 * (mounted in App.tsx) in non-dismissible mode via the force-open atom.
 *
 * We deliberately do NOT mount a second `<NewProjectDialog forceOpen />` here —
 * doing so produced two stacked Radix portals, and the always-mounted global one
 * (without forceOpen) won the visual stack, restoring the X / Esc / outside-click.
 */
export function EmptyStateShell() {
  const setOpen = useSetAtom(newProjectDialogOpenAtom);
  const setForceOpen = useSetAtom(newProjectDialogForceOpenAtom);

  useEffect(() => {
    setOpen(true);
    setForceOpen(true);
    return () => {
      setForceOpen(false);
    };
  }, [setOpen, setForceOpen]);

  return <div className="flex h-full items-center justify-center bg-background" />;
}
