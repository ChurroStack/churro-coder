import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '../../../lib/trpc';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { pendingBuildPlanSubChatIdAtom, pendingFixReviewIssuesAtom } from '../atoms';

// Tracks which CLI subChat sessions have had the MCP instruction injected into
// their first user message. Module-level so it resets on app restart (matching
// PTY lifetime). --append-system-prompt is ignored by Claude Code in plan mode
// because plan mode rebuilds the system prompt internally; injecting here into
// the conversation turn is the only reliable path.
const mcpInjectedSessions = new Set<string>();

// For tests only — lets test suites reset the module-level set between cases.
export function _resetMcpInjectedSessions(): void {
  mcpInjectedSessions.clear();
}

const CLI_MCP_REMINDER = 'IMPORTANT: call write_plan before ExitPlanMode.';

/**
 * Encode a payload for submission to a CLI TUI (Claude Code, Codex CLI).
 *
 * Single-line: one chunk — text + \r (Enter).
 * Multi-line: two chunks — bracketed-paste body, then a standalone \r.
 * Sending them as separate writes is required; the TUI's paste state machine
 * closes on ESC[201~ but does not treat a \r in the same chunk as a submit.
 */
function encodeForCliSubmit(payload: string): string[] {
  const hasNewline = payload.includes('\n') || payload.includes('\r');
  if (!hasNewline) {
    return [`${payload}\r`];
  }
  const normalized = payload.replace(/\r\n/g, '\n');
  return [`\x1b[200~${normalized}\x1b[201~`, '\r'];
}

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
export function useHarnessSendDispatcher(subChatId: string, harnessOverride?: 'builtin' | 'claude-cli' | 'codex-cli') {
  const storeHarness = useAgentSubChatStore(
    (s) => s.allSubChats.find((sc) => sc.id === subChatId)?.harness ?? 'builtin'
  );
  const harness = harnessOverride ?? storeHarness;
  const isCliHarness = harness === 'claude-cli' || harness === 'codex-cli';

  const writeToTerminal = trpc.terminal.write.useMutation();
  const setPendingBuildPlan = useSetAtom(pendingBuildPlanSubChatIdAtom);
  const setPendingFixReviewIssues = useSetAtom(pendingFixReviewIssuesAtom);

  const writeChunks = useCallback(
    (paneId: string, payload: string) => {
      for (const chunk of encodeForCliSubmit(payload)) {
        writeToTerminal.mutate({ paneId, data: chunk });
      }
    },
    [writeToTerminal]
  );

  const dispatch = useCallback(
    (text: string) => {
      if (!isCliHarness) return;
      let payload = text;
      if (!mcpInjectedSessions.has(subChatId)) {
        mcpInjectedSessions.add(subChatId);
        payload = `${CLI_MCP_REMINDER}\n${text}`;
      }
      writeChunks(`cli:${subChatId}`, payload);
    },
    [isCliHarness, subChatId, writeChunks]
  );

  const dispatchBuildPlan = useCallback(() => {
    if (isCliHarness) {
      writeChunks(
        `cli:${subChatId}`,
        'The plan has been approved. Please implement everything described in the plan.\n' +
          'Track progress with the MCP task tools:\n' +
          '(1) call write_tasks once with the initial list of plan steps (each task needs a stable short id, a title, and status: "pending");\n' +
          '(2) before starting a task call update_task_status with status: "in_progress"; after finishing call it again with status: "completed";\n' +
          '(3) if new tasks emerge or the structure changes, call write_tasks again with the full updated list.'
      );
    } else {
      setPendingBuildPlan(subChatId);
    }
  }, [isCliHarness, subChatId, writeChunks, setPendingBuildPlan]);

  const dispatchFixReviewIssues = useCallback(
    (message: string) => {
      if (isCliHarness) {
        writeChunks(`cli:${subChatId}`, message);
      } else {
        setPendingFixReviewIssues({ subChatId, message });
      }
    },
    [isCliHarness, subChatId, writeChunks, setPendingFixReviewIssues]
  );

  return { dispatch, dispatchBuildPlan, dispatchFixReviewIssues, isCliHarness, harness };
}
