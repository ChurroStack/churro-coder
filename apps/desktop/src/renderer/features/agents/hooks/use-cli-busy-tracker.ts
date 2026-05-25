import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useMemo } from 'react';
import { trpc } from '../../../lib/trpc';
import {
  agentFinishedTickAtomFamily,
  cliBusyAtomFamily,
  clearLoading,
  loadingSubChatsAtom,
  setLoading
} from '../atoms';
import { useStreamingStatusStore } from '../stores/streaming-status-store';

interface UseCliBusyTrackerOptions {
  subChatId: string | null | undefined;
  parentChatId: string | null | undefined;
  isCliHarness: boolean;
}

/**
 * Subscribes to the main-process `terminal.state` channel for a CLI subChat
 * and mirrors `'running' | 'idle'` into `cliBusyAtomFamily`. The main process
 * is the single source of truth: it emits transitions only, never
 * idle→idle / running→running, so this hook can react immediately with no
 * renderer-side debouncing.
 *
 * In addition to `cliBusyAtomFamily`, the same transitions are mirrored into
 * the two stores that the rest of the UI reads for "this subChat is working"
 * affordances:
 *  - `useStreamingStatusStore` — drives the dockview tab spinner via
 *    `ChatTabIcon` (renamable-tab.tsx).
 *  - `loadingSubChatsAtom` — drives sidebar row spinners, quick-switch
 *    dialogs, mobile header, workflow state, and the agent chat card.
 * Without these mirrors the working spinners stay hidden for CLI subChats,
 * which never mount `ChatViewInner` (the builtin-only writer of those
 * stores).
 *
 * On `'idle'` we additionally fan out cache invalidations for queries that
 * shadow CLI-written state (current tasks, plan, review, PR status, git
 * status). The previous implementation deferred these by 8s to filter TUI
 * redraw chatter — that filtering now lives in the main-process state
 * machine (cursor-activity sampler with hysteresis), so the cascade fires
 * the moment the CLI is actually quiet.
 */
export function useCliBusyTracker({ subChatId, parentChatId, isCliHarness }: UseCliBusyTrackerOptions) {
  const cliBusyAtom = useMemo(() => cliBusyAtomFamily(subChatId), [subChatId]);
  const [, setCliBusy] = useAtom(cliBusyAtom);
  const setLoadingSubChats = useSetAtom(loadingSubChatsAtom);
  const cliPaneId = isCliHarness ? `cli:${subChatId}` : null;
  const tickSubChat = useSetAtom(useMemo(() => agentFinishedTickAtomFamily(subChatId ?? ''), [subChatId]));
  const tickChat = useSetAtom(useMemo(() => agentFinishedTickAtomFamily(parentChatId ?? ''), [parentChatId]));
  const trpcUtils = trpc.useUtils();

  // Clear the shared spinner stores when the panel unmounts so a closed CLI
  // tab doesn't leave a stale "working" spinner on sidebar rows or quick-
  // switch entries that outlive the dockview tab.
  useEffect(() => {
    if (!isCliHarness || !subChatId) return;
    return () => {
      useStreamingStatusStore.getState().clearStatus(subChatId);
      clearLoading(setLoadingSubChats, subChatId);
    };
  }, [isCliHarness, subChatId, setLoadingSubChats]);

  trpc.terminal.state.useSubscription(cliPaneId ?? '', {
    enabled: !!cliPaneId,
    onData: ({ state }) => {
      if (state === 'running') {
        setCliBusy(true);
        if (subChatId) {
          useStreamingStatusStore.getState().setStatus(subChatId, 'streaming');
          if (parentChatId) {
            setLoading(setLoadingSubChats, subChatId, parentChatId);
          }
        }
        return;
      }
      setCliBusy(false);
      if (subChatId) {
        useStreamingStatusStore.getState().setStatus(subChatId, 'ready');
        clearLoading(setLoadingSubChats, subChatId);
      }
      tickSubChat();
      tickChat();
      if (subChatId) {
        void trpcUtils.chats.getCurrentTasks.invalidate({ subChatId });
        void trpcUtils.chats.getCurrentPlan.invalidate({ subChatId });
        void trpcUtils.chats.getCurrentReview.invalidate({ subChatId });
        void trpcUtils.chats.getReviewContent.invalidate({ subChatId });
      }
      void trpcUtils.chats.getPrStatus.invalidate({ chatId: parentChatId });
      void trpcUtils.chats.get.invalidate({ id: parentChatId });
      void trpcUtils.changes.getStatus.invalidate();
      void trpcUtils.changes.getBranches.invalidate();
    }
  });
}
