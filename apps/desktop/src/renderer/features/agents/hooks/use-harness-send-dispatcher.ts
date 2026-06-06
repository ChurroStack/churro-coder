import { useCallback, useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { trpc } from '../../../lib/trpc';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { pendingBuildPlanAtomFamily, pendingFixReviewIssuesAtomFamily } from '../atoms';
import { cliMcpReminder } from '../../../../shared/cli-mcp-reminder';

// Tracks which CLI subChat sessions have had the MCP instruction injected into
// their first user message. Module-level so it resets on app restart (matching
// PTY lifetime). --append-system-prompt is ignored by Claude Code in plan mode
// because plan mode rebuilds the system prompt internally; injecting here into
// the conversation turn is the only reliable path.
const mcpInjectedSessions = new Set<string>();

/**
 * Mark a sub-chat as already having received the MCP reminder. Used by
 * chat-cli-surface to seed sessions whose initial PTY chunks were injected
 * by buildCliBootstrap, so dispatch() doesn't re-inject on the user's next
 * typed message.
 */
export function markMcpInjected(subChatId: string): void {
  mcpInjectedSessions.add(subChatId);
}

/**
 * Drop a sub-chat's tracking entry. Called when the sub-chat (or its CLI
 * panel) is cleaned up so the Set doesn't accumulate dead entries over a long
 * renderer-process session.
 */
export function forgetMcpInjected(subChatId: string): void {
  mcpInjectedSessions.delete(subChatId);
}

// For tests only — lets test suites reset the module-level set between cases.
export function _resetMcpInjectedSessions(): void {
  mcpInjectedSessions.clear();
}

/**
 * Encode a payload for submission to a CLI TUI (Claude Code, Codex CLI).
 *
 * Always returns two chunks: the text body, then a sole \r (Enter).
 * Codex CLI's input box requires the \r to arrive as its own PTY write to
 * register as submit — a \r in the same chunk as the text is absorbed as a
 * literal CR instead. Both single-line and multi-line use this shape.
 *
 * `forceBracketedPaste` forces the bracketed-paste wrapping even for single-line
 * payloads. Needed for Codex's `$skill-name` invocations: typed `$` triggers
 * a skill autocomplete menu that swallows the trailing \r as a "select"
 * keypress instead of a submit. Bracketed paste tells the TUI the text was
 * pasted, bypassing the autocomplete menu entirely.
 */
function encodeForCliSubmit(payload: string, forceBracketedPaste = false): string[] {
  const hasNewline = payload.includes('\n') || payload.includes('\r');
  if (!hasNewline && !forceBracketedPaste) {
    return [payload, '\r'];
  }
  const normalized = payload.replace(/\r\n/g, '\n');
  return [`\x1b[200~${normalized}\x1b[201~`, '\r'];
}

/**
 * Write an expanded payload to a CLI PTY, injecting the MCP reminder on the
 * first message for this sub-chat session. Shared by useHarnessSendDispatcher
 * and useOpenSpecAction so both callers use identical encoding + injection logic.
 */
export function submitToCli(args: {
  subChatId: string;
  payload: string;
  writeMutation: { mutate: (args: { paneId: string; data: string }) => void };
  injectMcpReminderIfFirst?: boolean;
  forceBracketedPaste?: boolean;
}): void {
  const { subChatId, writeMutation, injectMcpReminderIfFirst = true, forceBracketedPaste = false } = args;
  let payload = args.payload;
  if (injectMcpReminderIfFirst && !mcpInjectedSessions.has(subChatId)) {
    mcpInjectedSessions.add(subChatId);
    payload = `${cliMcpReminder(subChatId)}\n${payload}`;
  }
  for (const chunk of encodeForCliSubmit(payload, forceBracketedPaste)) {
    writeMutation.mutate({ paneId: `cli:${subChatId}`, data: chunk });
  }
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
 *   builtin → flips this subChat's `pendingBuildPlanAtomFamily(subChatId)` to true (triggers handleApprovePlan).
 *   CLI     → writes a natural-language approve instruction to the terminal.
 *
 * `dispatchFixReviewIssues(message)` — "Fix review issues" action.
 *   builtin → writes the rendered prompt into `pendingFixReviewIssuesAtomFamily(subChatId)`.
 *   CLI     → writes the message to the terminal.
 */
export function useHarnessSendDispatcher(subChatId: string, harnessOverride?: 'builtin' | 'claude-cli' | 'codex-cli') {
  const storeHarness = useAgentSubChatStore(
    (s) => s.allSubChats.find((sc) => sc.id === subChatId)?.harness ?? 'builtin'
  );
  const harness = harnessOverride ?? storeHarness;
  const isCliHarness = harness === 'claude-cli' || harness === 'codex-cli';

  const writeToTerminal = trpc.terminal.write.useMutation();
  const setPendingBuildPlan = useSetAtom(useMemo(() => pendingBuildPlanAtomFamily(subChatId), [subChatId]));
  const setPendingFixReviewIssues = useSetAtom(useMemo(() => pendingFixReviewIssuesAtomFamily(subChatId), [subChatId]));

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
      submitToCli({ subChatId, payload: text, writeMutation: writeToTerminal });
    },
    [isCliHarness, subChatId, writeToTerminal]
  );

  const dispatchBuildPlan = useCallback(() => {
    if (isCliHarness) {
      const codexMsg =
        'The plan has been approved. Implement it now.\n\n' +
        `Sub-chat id: ${subChatId}. Pass this exact string as subChatId on every churro-coder MCP tool call.\n\n` +
        'You MUST use the MCP tools from the churro-coder server to retrieve the plan and track progress:\n' +
        '1. Call read_plan to retrieve the full approved plan text.\n' +
        '2. Call write_tasks with the complete list of plan steps (each step needs a stable short id, a title, and status: "pending").\n' +
        '3. Before starting each step, call update_task_status with status: "in_progress".\n' +
        '4. After finishing each step, call update_task_status with status: "completed".\n' +
        '5. If the task structure changes mid-implementation, call write_tasks again with the full updated list.\n\n' +
        'Skipping these tool calls leaves the user UI blank — that is a failure. Start by calling read_plan now.';
      const claudeMsg =
        'The plan has been approved. Please implement everything described in the plan.\n' +
        `Sub-chat id: ${subChatId}. Pass this exact string as subChatId on every churro-coder MCP tool call.\n` +
        'Track progress with the MCP task tools:\n' +
        '(1) call write_tasks once with the initial list of plan steps (each task needs a stable short id, a title, and status: "pending");\n' +
        '(2) before starting a task call update_task_status with status: "in_progress"; after finishing call it again with status: "completed";\n' +
        '(3) if new tasks emerge or the structure changes, call write_tasks again with the full updated list.';
      writeChunks(`cli:${subChatId}`, harness === 'codex-cli' ? codexMsg : claudeMsg);
    } else {
      setPendingBuildPlan(true);
    }
  }, [isCliHarness, harness, subChatId, writeChunks, setPendingBuildPlan]);

  const dispatchFixReviewIssues = useCallback(
    (message: string) => {
      if (isCliHarness) {
        writeChunks(`cli:${subChatId}`, message);
      } else {
        setPendingFixReviewIssues(message);
      }
    },
    [isCliHarness, subChatId, writeChunks, setPendingFixReviewIssues]
  );

  const dispatchReview = useCallback(() => {
    if (!isCliHarness) return;
    const claudeMsg =
      'Run the code-review skill to analyze the current diff, then produce and persist the Review artifact.\n\n' +
      `Sub-chat id: ${subChatId}. Pass this exact string as subChatId on every churro-coder MCP tool call.\n\n` +
      'Steps:\n' +
      '1. Invoke the Skill tool with skill: "code-review". It returns a JSON array of findings\n' +
      '   with fields: file, line, summary, failure_scenario.\n' +
      '   If the Skill tool is unavailable, fall back to `git diff origin/HEAD` manually.\n' +
      '2. If more than 15 findings, keep the 15 most impactful.\n' +
      '3. For every finding classify severity using this rubric:\n' +
      '   - 🔴 high: security holes, data corruption, crashes, data loss, critical broken paths\n' +
      '   - 🟡 medium: edge-case bugs, perf regressions, UX problems, non-trivial incorrect behavior\n' +
      '   - 🟢 low: code quality, style, minor inefficiencies, cleanup\n' +
      '4. Derive a Suggestion (1–2 sentences) from the failure_scenario.\n' +
      '5. Build a single markdown document:\n' +
      '   # Code Review\n' +
      '   ## Summary\n' +
      '   [brief description of what the changes do]\n' +
      '   ## Issues Found\n' +
      '   | Severity | File:Line | Issue | Suggestion |\n' +
      '   |----------|-----------|-------|------------|\n' +
      '   | 🔴 high | path/file.ts:42 | [summary] | [suggestion] |\n' +
      '   If no issues: state "Code looks good."\n' +
      `6. Call write_review with subChatId: "${subChatId}" and the markdown above. ` +
      'This persists the review and updates the Review milestone in the UI.';
    const codexMsg =
      'Review the code changes in the current branch compared to the base branch.\n' +
      'Use your built-in /review capability to analyze the diff and surface findings.\n\n' +
      `Sub-chat id: ${subChatId}. Pass this exact string as subChatId on every churro-coder MCP tool call.\n\n` +
      'After gathering findings:\n' +
      '1. If more than 15 findings, keep the 15 most impactful.\n' +
      '2. Classify each finding:\n' +
      '   - 🔴 high: security, crashes, data loss, critical broken paths\n' +
      '   - 🟡 medium: edge-case bugs, perf, UX, non-trivial incorrect behavior\n' +
      '   - 🟢 low: code quality, style, minor inefficiencies\n' +
      '3. Format as a single markdown document (summary + severity table).\n' +
      `4. Call write_review with subChatId: "${subChatId}" and the markdown. ` +
      'This persists the review and updates the Review milestone in the UI.';
    writeChunks(`cli:${subChatId}`, harness === 'claude-cli' ? claudeMsg : codexMsg);
  }, [isCliHarness, harness, subChatId, writeChunks]);

  return { dispatch, dispatchBuildPlan, dispatchFixReviewIssues, dispatchReview, isCliHarness, harness };
}
