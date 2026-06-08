import { useCallback } from 'react';
import { useDockApi } from './dock-context';
import { addOrFocus } from './add-or-focus';

/**
 * `useOpenFileInDock` — opens a file in a full dockview tab via the `file`
 * panel (`FilePanel` → `FileViewerSidebar`, which routes to the Markdown /
 * Code / Image viewer by extension). `addOrFocus` dedupes by the panel id
 * derived from the absolute path, so re-opening the same file focuses the
 * existing tab instead of stacking duplicates.
 *
 * `worktreePath` is the root that relative paths are resolved against. It must
 * be the worktree of the chat that owns the clicked reference (NOT the globally
 * active chat), so a file reference in a non-focused split panel still resolves
 * correctly. Agent file boxes already carry absolute `file_path`s.
 *
 * Graceful fallback to `fallback` (the caller's existing side-peek / full-page
 * opener) in two cases, so a click is never a dead no-op:
 *   - no dock API yet (cold start / non-dock surface);
 *   - a relative path with no worktree to anchor it (avoids producing a
 *     filesystem-root path that would resolve to a missing file).
 */
export function useOpenFileInDock(
  subChatId: string | undefined,
  worktreePath: string | null | undefined,
  fallback: (filePath: string) => void
): (filePath: string) => void {
  const dockApi = useDockApi();
  return useCallback(
    (filePath: string) => {
      if (!filePath) return;
      if (!dockApi) {
        fallback(filePath);
        return;
      }
      let absolutePath: string;
      if (filePath.startsWith('/')) {
        absolutePath = filePath;
      } else if (worktreePath) {
        absolutePath = `${worktreePath}/${filePath}`;
      } else {
        // Relative path but no worktree to anchor it — defer to the fallback
        // rather than emit a root-anchored "/<relative>" path.
        fallback(filePath);
        return;
      }
      addOrFocus(dockApi, { kind: 'file', data: { absolutePath, subChatId } });
    },
    [dockApi, worktreePath, subChatId, fallback]
  );
}
