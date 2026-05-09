/**
 * `useSubChatMode` — single facade for reading and writing the active
 * sub-chat's mode. DB is the canonical source; React Query (tRPC) cache
 * handles the synchronous path so UI flips before any await.
 *
 * **Reading:** reads `chats.getSubChat({ id: subChatId }).mode`.
 * **Writing:** `setMode(newMode)` does two things synchronously:
 *   1. `setData` on the `getSubChat` cache — all UI re-renders
 *      immediately (preserves the PR #36 invariant).
 *   2. Syncs to the Zustand `allSubChats` list so the sidebar stays current.
 *   Then fires the async `updateSubChatMode` mutation to persist to DB.
 *
 * Use this hook wherever a component currently reads
 * `subChatModeAtomFamily(subChatId)`. Do NOT access that atom directly —
 * it has been removed.
 */

import { useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { normalizeAgentMode, type AgentMode } from '../atoms';

export function useSubChatMode(subChatId: string): {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
} {
  const utils = trpc.useUtils();

  const { data: subChat } = trpc.chats.getSubChat.useQuery({ id: subChatId }, { enabled: !!subChatId });

  const updateMode = trpc.chats.updateSubChatMode.useMutation();

  const setMode = useCallback(
    (mode: AgentMode) => {
      // Synchronous cache write — all subscribers re-render before the await below.
      utils.chats.getSubChat.setData({ id: subChatId }, (prev) => (prev ? { ...prev, mode } : prev));
      // Keep the Zustand list in sync so the sidebar sub-chat list shows the new mode.
      useAgentSubChatStore.getState().updateSubChatMode(subChatId, mode);
      // Async DB persist (temp- IDs are optimistic rows that will be replaced).
      if (!subChatId.startsWith('temp-')) {
        updateMode.mutate({ id: subChatId, mode });
      }
    },
    [subChatId, utils, updateMode]
  );

  const mode = normalizeAgentMode(subChat?.mode);

  return { mode, setMode };
}
