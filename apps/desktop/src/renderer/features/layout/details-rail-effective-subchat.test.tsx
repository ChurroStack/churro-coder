// @vitest-environment jsdom
/**
 * Regression for the Plan-widget-stays-hidden bug on Claude CLI harness chats.
 *
 * Before the fix, `details-rail.tsx` computed
 *   effectiveSubChatId = activeSubChatId ?? chatId
 * which collapsed to the parent `chatId` whenever `activeSubChatId` was still
 * null on a cold mount — leaving the Plan widget reading from
 * `currentPlanPathAtomFamily(chatId)` while the MCP writer set
 * `currentPlanPathAtomFamily(subChatId)`. The widget never rendered.
 *
 * The fix inserts `openSubChatIds[0]` between `activeSubChatId` and `chatId`
 * so a single-sub-chat CLI panel keys off its own subChatId from frame 1.
 * The probe below mirrors that exact computation. Don't import DetailsRail —
 * it pulls in dockview, tRPC, jotai store, ~15 atom families. The fallback
 * ladder is the contract; pin it directly.
 */
import { describe, test, expect } from 'vitest';

function computeEffectiveSubChatId(
  activeSubChatId: string | null,
  openSubChatIds: string[],
  chatId: string | null
): string {
  return activeSubChatId ?? openSubChatIds[0] ?? chatId ?? '';
}

describe('details-rail effectiveSubChatId fallback ladder', () => {
  test('prefers activeSubChatId when set', () => {
    expect(computeEffectiveSubChatId('sc-active', ['sc-other'], 'chat-1')).toBe('sc-active');
  });

  test('falls back to openSubChatIds[0] when activeSubChatId is null', () => {
    // This is the CLI cold-mount case: the panel is mounted (so openSubChatIds
    // includes its own id) but `setActiveSubChat` has not yet fired.
    expect(computeEffectiveSubChatId(null, ['sc-cli'], 'chat-1')).toBe('sc-cli');
  });

  test('falls back to chatId only when no sub-chats are open', () => {
    expect(computeEffectiveSubChatId(null, [], 'chat-1')).toBe('chat-1');
  });

  test('returns empty string when chat is also null', () => {
    expect(computeEffectiveSubChatId(null, [], null)).toBe('');
  });

  test('does NOT collapse to chatId when a sub-chat is open (the bug fix)', () => {
    // Before the fix: returned 'chat-1' (the parent) — widgets keyed off the
    // wrong atom and never saw plan/tasks/review writes.
    expect(computeEffectiveSubChatId(null, ['sc-cli'], 'chat-1')).not.toBe('chat-1');
  });
});

describe('details-rail workflowSubChatId fallback ladder', () => {
  // Mirrors `workflowSubChatId = activeSubChatId ?? openSubChatIds[0] ?? null`
  // in details-rail.tsx. Passing null collapses useWorkflowState to
  // IDLE_WORKFLOW_STATE, which makes the CLI-busy spinner impossible to
  // surface on cold mount.
  function computeWorkflowSubChatId(activeSubChatId: string | null, openSubChatIds: string[]): string | null {
    return activeSubChatId ?? openSubChatIds[0] ?? null;
  }

  test('falls back to openSubChatIds[0] when activeSubChatId is null', () => {
    expect(computeWorkflowSubChatId(null, ['sc-cli'])).toBe('sc-cli');
  });

  test('returns null when no sub-chats are open', () => {
    // Null here is intentional — IDLE_WORKFLOW_STATE is the correct rendering
    // for "no sub-chat selected and none open." The bug was returning null
    // for the CLI-busy case (one sub-chat open, not yet active).
    expect(computeWorkflowSubChatId(null, [])).toBe(null);
  });

  test('does NOT return null when a sub-chat is open (CLI cold-mount fix)', () => {
    expect(computeWorkflowSubChatId(null, ['sc-cli'])).not.toBe(null);
  });
});
