import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '../../../lib/trpc';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { pendingBuildPlanSubChatIdAtom, pendingFixReviewIssuesAtom } from '../atoms';

/**
 * Harness-aware send dispatcher.
 *
 * Returns three action creators that route to the correct send path based on
 * the subChat's harness:
 *
 *   builtin   → atom-based paths consumed by active-chat.tsx's sendPending /
 *               handleApprovePlan effects (unchanged from pre-harness behavior)
 *   claude-cli / codex-cli → terminal.write to paneId `cli:<subChatId>`
 *
 * `dispatch(text)` — arbitrary text send (used by chat-input-area for CLI and
 *   by any future sidebar button that does not need special builtin semantics).
 *   For builtin it is a no-op: builtin callers should call `onSend()` or one
 *   of the specialized dispatchers below.
 *
 * `dispatchBuildPlan()` — "Approve / Build plan" action.
 *   builtin → sets pendingBuildPlanSubChatIdAtom (triggers handleApprovePlan).
 *   CLI     → writes a natural-language approve instruction to the terminal.
 *
 * `dispatchFixReviewIssues(message)` — "Fix review issues" action.
 *   builtin → sets pendingFixReviewIssuesAtom with the rendered prompt.
 *   CLI     → writes the message to the terminal.
 */
export function useHarnessSendDispatcher(subChatId: string) {
  const harness = useAgentSubChatStore((s) => s.allSubChats.find((sc) => sc.id === subChatId)?.harness ?? 'builtin');
  const isCliHarness = harness === 'claude-cli' || harness === 'codex-cli';

  const writeToTerminal = trpc.terminal.write.useMutation();
  const setPendingBuildPlan = useSetAtom(pendingBuildPlanSubChatIdAtom);
  const setPendingFixReviewIssues = useSetAtom(pendingFixReviewIssuesAtom);

  const dispatch = useCallback(
    (text: string) => {
      if (!isCliHarness) return;
      writeToTerminal.mutate({ paneId: `cli:${subChatId}`, data: `${text}\r` });
    },
    [isCliHarness, subChatId, writeToTerminal]
  );

  const dispatchBuildPlan = useCallback(() => {
    if (isCliHarness) {
      writeToTerminal.mutate({
        paneId: `cli:${subChatId}`,
        data: `The plan has been approved. Please implement everything described in the plan.\r`
      });
    } else {
      setPendingBuildPlan(subChatId);
    }
  }, [isCliHarness, subChatId, writeToTerminal, setPendingBuildPlan]);

  const dispatchFixReviewIssues = useCallback(
    (message: string) => {
      if (isCliHarness) {
        writeToTerminal.mutate({ paneId: `cli:${subChatId}`, data: `${message}\r` });
      } else {
        setPendingFixReviewIssues({ subChatId, message });
      }
    },
    [isCliHarness, subChatId, writeToTerminal, setPendingFixReviewIssues]
  );

  return { dispatch, dispatchBuildPlan, dispatchFixReviewIssues, isCliHarness, harness };
}
