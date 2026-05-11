import { useCallback } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { FileViewerSidebar } from '../../file-viewer/components/file-viewer-sidebar';
import { useActiveWorktreePath } from '../../agents/hooks/use-active-worktree-path';
import type { FilePanelEntity } from '../atoms';

/**
 * FilePanel — full-pane file viewer. Wraps FileViewerSidebar (which routes
 * to Code/Markdown/Image viewers based on extension). Uses the panel's own
 * close (api.close) for the onClose callback, which is caught by DockShell's
 * onDidRemovePanel listener.
 */
export function FilePanel({ params, api }: IDockviewPanelProps<FilePanelEntity>) {
  const projectPath = useActiveWorktreePath() ?? '';

  const handleClose = useCallback(() => {
    api.close();
  }, [api]);

  return (
    <div className="h-full w-full overflow-hidden border-t border-border">
      <FileViewerSidebar filePath={params.absolutePath} projectPath={projectPath} onClose={handleClose} />
    </div>
  );
}
