import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { subChatFilesAtom } from '../atoms';
import { getDisplayPath } from './use-changed-files-tracking';

/**
 * For CLI-harness sub-chats: queries the MCP file-changes store and merges
 * those paths into subChatFilesAtom so the Changes widget scopes its diff
 * to files this sub-chat reported via notify_files_changed.
 *
 * Mount only in ChatCliSurface — built-in chats already get coverage via
 * useChangedFilesTracking.
 */
export function useMcpFileChangesTracking(subChatId: string, projectPath?: string) {
  const setSubChatFiles = useSetAtom(subChatFilesAtom);

  const { data } = trpc.chats.getMcpFileChanges.useQuery({ subChatId }, { enabled: !!subChatId, staleTime: 0 });

  useEffect(() => {
    if (!data || !data.exists) return;

    setSubChatFiles((prev) => {
      const next = new Map(prev);
      const existing = next.get(subChatId) ?? [];
      const seen = new Set(existing.map((e) => e.filePath));
      const merged = [...existing];
      for (const entry of data.entries) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        merged.push({
          filePath: entry.path,
          displayPath: getDisplayPath(entry.path, projectPath),
          additions: 0,
          deletions: 0
        });
      }
      next.set(subChatId, merged);
      return next;
    });
  }, [data, subChatId, projectPath, setSubChatFiles]);
}
