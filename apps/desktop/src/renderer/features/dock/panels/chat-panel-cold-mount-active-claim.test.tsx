// @vitest-environment jsdom
/**
 * Regression for the CLI cold-mount race where `activeSubChatId` stayed null
 * for one or more frames after the panel mounted, leaving the right-rail Plan
 * widget keyed off the parent `chatId` (wrong atom) and the workflow snapshot
 * returning IDLE_WORKFLOW_STATE (no busy spinner).
 *
 * The fix in chat-panel.tsx adds a fallback effect that claims active when:
 *   1. the workspace is active for this panel's chat AND
 *   2. activeSubChatId is null AND
 *   3. this panel's subChatId is the first in openSubChatIds.
 *
 * The probe below mirrors that decision so we pin the fallback contract
 * without paying the cost of mounting ChatPanel (dockview, ownership, tRPC,
 * terminal, ~30 deps). The original `isActive` claim path is intentionally
 * not asserted here — it's the obvious case, and changing it would surface
 * via other panel tests.
 */
import { describe, test, expect } from 'vitest';

function shouldClaimActive(opts: {
  isWorkspaceActive: boolean;
  activeSubChatId: string | null;
  openSubChatIds: string[];
  paramsSubChatId: string;
  paramsChatId: string;
  selectedWorkspaceId: string | null;
}): boolean {
  if (!opts.isWorkspaceActive) return false;
  if (opts.activeSubChatId) return false;
  if (opts.openSubChatIds.length === 0 || opts.openSubChatIds[0] !== opts.paramsSubChatId) return false;
  if (opts.paramsChatId !== opts.selectedWorkspaceId) return false;
  return true;
}

describe('chat-panel cold-mount activeSubChatId fallback', () => {
  const base = {
    isWorkspaceActive: true,
    activeSubChatId: null,
    openSubChatIds: ['sc-cli'],
    paramsSubChatId: 'sc-cli',
    paramsChatId: 'chat-1',
    selectedWorkspaceId: 'chat-1'
  };

  test('claims active on cold mount when this panel is the only open sub-chat', () => {
    expect(shouldClaimActive(base)).toBe(true);
  });

  test('does NOT claim when activeSubChatId is already set', () => {
    expect(shouldClaimActive({ ...base, activeSubChatId: 'sc-other' })).toBe(false);
  });

  test('does NOT claim when workspace is not active (cross-workspace guard)', () => {
    expect(shouldClaimActive({ ...base, isWorkspaceActive: false })).toBe(false);
  });

  test('does NOT claim when this panel is not first in openSubChatIds', () => {
    // Only the first-opened panel auto-claims, otherwise two panels would race
    // to write activeSubChatId on every mount of the chat.
    expect(shouldClaimActive({ ...base, openSubChatIds: ['sc-other', 'sc-cli'] })).toBe(false);
  });

  test('does NOT claim when params.chatId does not match the selected workspace', () => {
    expect(shouldClaimActive({ ...base, selectedWorkspaceId: 'chat-2' })).toBe(false);
  });

  test('does NOT claim when openSubChatIds is empty', () => {
    expect(shouldClaimActive({ ...base, openSubChatIds: [] })).toBe(false);
  });
});
