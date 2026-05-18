import { useAtom, useSetAtom } from 'jotai';
import { useMemo } from 'react';
import { trpc } from '../../../lib/trpc';
import { agentFinishedTickAtomFamily, cliBusyAtomFamily } from '../atoms';

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
  const cliPaneId = isCliHarness ? `cli:${subChatId}` : null;
  const tickSubChat = useSetAtom(useMemo(() => agentFinishedTickAtomFamily(subChatId ?? ''), [subChatId]));
  const tickChat = useSetAtom(useMemo(() => agentFinishedTickAtomFamily(parentChatId ?? ''), [parentChatId]));
  const trpcUtils = trpc.useUtils();

  trpc.terminal.state.useSubscription(cliPaneId ?? '', {
    enabled: !!cliPaneId,
    onData: ({ state }) => {
      if (state === 'running') {
        setCliBusy(true);
        return;
      }
      setCliBusy(false);
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
