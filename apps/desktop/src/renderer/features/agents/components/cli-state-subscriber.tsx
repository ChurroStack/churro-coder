import { useEffect, useReducer, useRef } from 'react';
import { trpc } from '../../../lib/trpc';
import { appStore } from '../../../lib/jotai-store';
import {
  agentFinishedTickAtomFamily,
  agentsSubChatUnseenChangesAtom,
  agentsUnseenChangesAtom,
  clearSubChatBusy,
  selectedAgentChatIdAtom,
  setSubChatBusy,
  subChatBusyAtom
} from '../atoms';
import { useAgentSubChatStore } from '../stores/sub-chat-store';

/**
 * Single global subscriber for ALL CLI sub-chats' busy state. Mounted exactly
 * once at the app root (inside `TRPCProvider`), survives every workspace
 * switch and every dockview tab switch. Replaces the deleted per-panel
 * `useCliBusyTracker` hook, which was bound to `ChatPanel`'s React lifecycle
 * and got wiped on every dockview unmount (the root cause of the original
 * disappearing-spinner bug).
 *
 * Wire-up:
 *   main process: terminal/manager.ts → emits `cli-state` events on every
 *     running↔idle transition AND on PTY exit (state: 'exited').
 *   tRPC bridge: terminal.allCliStates subscription — attaches the listener
 *     BEFORE emitting the initial snapshot so an in-flight transition is
 *     never lost in the gap.
 *   renderer: this component — does ONE write per transition to
 *     `subChatBusyAtom` (the single source of truth). All consumer surfaces
 *     (sidebar workspace row, dock tab spinner, sub-chats sidebar, kanban
 *     card, workflow notch) read derived atom families over the same source,
 *     so they can never disagree about whether a sub-chat is busy.
 *
 *     The `parentChatId &&` guard from the old triple-write codepath is
 *     intentionally removed — a null parentChatId is recorded as `null` in
 *     the entry. Parent-keyed consumers (workspace row, project group
 *     header, kanban card) skip null-parented entries; subChatId-keyed
 *     consumers still flip on.
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
      console.log(`[sub-chat-busy] cli sub=${subChatId} state=${state} parent=${parentChatId ?? 'null'}`);

      // Snapshot busy BEFORE the write so we can tell a genuine running→idle
      // transition (this sub-chat just finished a turn) from the late-subscriber
      // idle snapshot (it was never running this session).
      const wasRunning = appStore.get(subChatBusyAtom).has(subChatId);

      const setBusy = (fn: Parameters<Parameters<typeof setSubChatBusy>[0]>[0]) => appStore.set(subChatBusyAtom, fn);
      if (state === 'running') {
        setSubChatBusy(setBusy, subChatId, { state: 'running', parentChatId, source: 'cli' });
      } else {
        // idle and exited both clear the entry — parent-keyed consumers can
        // see "stopped" the same way and the on-finish fan-out still runs.
        clearSubChatBusy(setBusy, subChatId);
      }

      // Cache invalidation fan-out on idle/exit. The MCP write tools (write_plan,
      // write_review, write_tasks, update_task_status) cause this CLI to have
      // just produced fresh artifacts the renderer hasn't reread yet. Skip when
      // parentChatId is unknown — the per-chat invalidations need a key.
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

        // Light the left-sidebar "unseen changes" dot when a CLI sub-chat
        // finishes a turn while the user is looking elsewhere — the CLI
        // equivalent of the builtin transport's onFinish fan-out
        // (use-transport-factory-deps.ts). Gate on `wasRunning` so the
        // late-subscriber idle snapshot never flags a session that didn't run.
        // The clear side lives in chat-panel.tsx (CLI panels don't mount the
        // builtin ChatView that clears it for builtin sub-chats).
        if (wasRunning) {
          const activeSubChatId = useAgentSubChatStore.getState().activeSubChatId;
          const selectedChatId = appStore.get(selectedAgentChatIdAtom);
          if (activeSubChatId !== subChatId) {
            appStore.set(agentsSubChatUnseenChangesAtom, (prev) => {
              if (prev.has(subChatId)) return prev;
              const next = new Set(prev);
              next.add(subChatId);
              return next;
            });
          }
          if (selectedChatId !== parentChatId) {
            appStore.set(agentsUnseenChangesAtom, (prev) => {
              if (prev.has(parentChatId)) return prev;
              const next = new Set(prev);
              next.add(parentChatId);
              return next;
            });
          }
        }
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
