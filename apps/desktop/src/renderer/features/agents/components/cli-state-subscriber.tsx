import { useEffect, useReducer, useRef } from 'react';
import { trpc } from '../../../lib/trpc';
import { appStore } from '../../../lib/jotai-store';
import {
  agentFinishedTickAtomFamily,
  cliRunningStatesAtom,
  clearLoading,
  loadingSubChatsAtom,
  setLoading
} from '../atoms';
import { useStreamingStatusStore } from '../stores/streaming-status-store';

/**
 * Single global subscriber for ALL CLI sub-chats' busy state. Mounted exactly
 * once at the app root (inside `TRPCProvider`), survives every workspace
 * switch and every dockview tab switch. Replaces the deleted per-panel
 * `useCliBusyTracker` hook, which was bound to `ChatPanel`'s React lifecycle
 * and got wiped on every dockview unmount (the root cause of the
 * disappearing-spinner bug).
 *
 * Wire-up:
 *   main process: terminal/manager.ts → emits `cli-state` events on every
 *     running↔idle transition AND on PTY exit (state: 'exited').
 *   tRPC bridge: terminal.allCliStates subscription — attaches the listener
 *     BEFORE emitting the initial snapshot so an in-flight transition is
 *     never lost in the gap.
 *   renderer: this component — writes to `cliRunningStatesAtom` (single
 *     source of truth) and mirrors the same transitions into the two other
 *     stores that historical callers still read directly:
 *       - useStreamingStatusStore → dockview tab spinner
 *       - loadingSubChatsAtom     → sidebar rows / quick-switch / workflow
 *     `cliBusyAtomFamily` is now a *derived* atomFamily over the source map,
 *     so there's no separate write for it.
 *
 * Reconnect strategy: tRPC subscriptions do NOT auto-retry on `onError`. We
 * keep an `enabled` state; on error we flip it false then back to true after
 * a delay. The hook's internal `reset` callback (in @trpc/react-query
 * createHooksInternal) is memoized on `enabled`, so the toggle re-runs the
 * subscribe effect.
 */
export function CliStateSubscriber() {
  const trpcUtils = trpc.useUtils();
  const [enabledTick, bumpEnabled] = useReducer((n: number) => n + 1, 0);
  // `enabled` is true on even ticks, false on odd — flipping the tick toggles
  // it and re-triggers the subscription. We don't strictly need the off-pass
  // (the @trpc reset would re-run on `enabled` change alone), but routing
  // through both states makes the error path's logging match reality.
  const enabled = enabledTick % 2 === 0;
  // Tracks the pending reconnect timer so a burst of `onError` events doesn't
  // stack timeouts (each would flip `enabled` independently). Cleared before
  // scheduling a new one and on unmount.
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };
  }, []);

  trpc.terminal.allCliStates.useSubscription(undefined, {
    enabled,
    onData: ({ subChatId, parentChatId, state }) => {
      console.log(`[cli-state-subscriber] sub=${subChatId} state=${state}`);

      // 1. Update the single source of truth.
      appStore.set(cliRunningStatesAtom, (prev) => {
        const next = new Map(prev);
        if (state === 'exited') {
          if (!next.has(subChatId)) return prev;
          next.delete(subChatId);
        } else {
          const existing = next.get(subChatId);
          if (existing && existing.state === state && existing.parentChatId === parentChatId) {
            return prev;
          }
          next.set(subChatId, { state, parentChatId });
        }
        return next;
      });

      // 2. Mirror to streaming-status-store (dock tab spinner via ChatTabIcon).
      if (state === 'running') {
        useStreamingStatusStore.getState().setStatus(subChatId, 'streaming');
      } else {
        useStreamingStatusStore.getState().setStatus(subChatId, 'ready');
      }

      // 3. Mirror to loadingSubChatsAtom (sidebar rows / quick-switch / mobile
      //    header / workflow card / agent chat card). parentChatId is required
      //    for the Map<subChatId, parentChatId> shape — when the main process
      //    didn't have a workspaceId on the session we get null and skip.
      const setLoadingSubChats = (fn: (prev: Map<string, string>) => Map<string, string>) =>
        appStore.set(loadingSubChatsAtom, fn);
      if (state === 'running' && parentChatId) {
        setLoading(setLoadingSubChats, subChatId, parentChatId);
      } else {
        clearLoading(setLoadingSubChats, subChatId);
      }

      // 4. On idle/exit: same cache invalidation fan-out the deleted
      //    useCliBusyTracker did. The MCP write tools (write_plan,
      //    write_review, write_tasks, update_task_status) cause this CLI to
      //    have just produced fresh artifacts the renderer hasn't reread yet.
      if (state !== 'running' && parentChatId) {
        appStore.set(agentFinishedTickAtomFamily(subChatId));
        appStore.set(agentFinishedTickAtomFamily(parentChatId));
        void trpcUtils.chats.getCurrentTasks.invalidate({ subChatId });
        void trpcUtils.chats.getCurrentPlan.invalidate({ subChatId });
        void trpcUtils.chats.getCurrentReview.invalidate({ subChatId });
        void trpcUtils.chats.getReviewContent.invalidate({ subChatId });
        void trpcUtils.chats.getPrStatus.invalidate({ chatId: parentChatId });
        void trpcUtils.chats.get.invalidate({ id: parentChatId });
        void trpcUtils.changes.getStatus.invalidate();
        void trpcUtils.changes.getBranches.invalidate();
      }
    },
    onError: (err) => {
      console.error('[cli-state-subscriber] subscription error — resubscribing in 1s', err);
      // Step 1: bump now to flip enabled off (the subscribe effect tears down).
      bumpEnabled();
      // Step 2: bump again after 1s to flip it back on. Clear any prior pending
      // timer first so a burst of errors collapses to a single reconnect.
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(() => {
        reconnectRef.current = null;
        bumpEnabled();
      }, 1000);
    }
  });

  return null;
}
