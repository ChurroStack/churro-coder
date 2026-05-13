import { AlertTriangle, Pencil, Redo2, Save, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';

export interface FileViewerDockApi {
  close: () => void;
  setTitle: (title: string) => void;
}

export function formatDraftedAt(draftedAt: number): string {
  return new Date(draftedAt).toLocaleString();
}

export function DraftConflictBanner({ draftedAt }: { draftedAt: number }) {
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          This file changed after your draft was created on {formatDraftedAt(draftedAt)}. Your draft is active. Save to
          keep your version or discard to use the on-disk file.
        </p>
      </div>
    </div>
  );
}

export function UnsavedChangesDialog({
  open,
  title = 'Discard changes?',
  description = 'Are you sure you want to discard your changes?',
  confirmLabel = 'Discard',
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[360px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="px-5 pb-5">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function EditModeButtons({
  isEditMode,
  isSaving,
  onEnterEditMode,
  onSave,
  onDiscard,
  onUndo,
  onRedo
}: {
  isEditMode: boolean;
  isSaving?: boolean;
  onEnterEditMode: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  if (!isEditMode) {
    return (
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onEnterEditMode}>
        <Pencil className="h-3.5 w-3.5" />
        Edit content
      </Button>
    );
  }

  return (
    <>
      <Button variant="default" size="sm" className="h-7 gap-1.5 text-xs" onClick={onSave} disabled={isSaving}>
        <Save className="h-3.5 w-3.5" />
        Save
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onDiscard} disabled={isSaving}>
        Discard changes
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onUndo} disabled={isSaving}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRedo} disabled={isSaving}>
        <Redo2 className="h-4 w-4" />
      </Button>
    </>
  );
}
