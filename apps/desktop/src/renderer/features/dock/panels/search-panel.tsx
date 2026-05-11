import { useCallback } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { SearchTab } from '../../details-sidebar/sections/search-tab';
import { useActiveWorktreePath } from '../../agents/hooks/use-active-worktree-path';
import { useDockApi } from '../dock-context';
import { addOrFocus } from '../add-or-focus';
import type { SearchPanelEntity } from '../atoms';

/**
 * SearchPanel — full-pane code search across the project. Clicking a result
 * opens the matching file as a dockview file panel via addOrFocus.
 */
export function SearchPanel({ params }: IDockviewPanelProps<SearchPanelEntity>) {
  const worktreePath = useActiveWorktreePath();
  const dockApi = useDockApi();

  const handleSelectFile = useCallback(
    (filePath: string) => {
      if (!dockApi) return;
      addOrFocus(dockApi, {
        kind: 'file',
        data: { absolutePath: filePath }
      });
    },
    [dockApi]
  );

  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-background border-t border-border">
      <SearchTab worktreePath={worktreePath} onSelectFile={handleSelectFile} isActive />
    </div>
  );
}
