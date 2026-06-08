import { describe, test, expect } from 'vitest';
import { deriveApprovalIdSets } from './use-pending-plan-approvals';

describe('deriveApprovalIdSets', () => {
  test('undefined / empty rows → empty sets (stable EMPTY reference)', () => {
    const a = deriveApprovalIdSets(undefined);
    const b = deriveApprovalIdSets([]);
    expect(a.subChatIds.size).toBe(0);
    expect(a.chatIds.size).toBe(0);
    // Same shared EMPTY reference so consumers' useMemo deps stay stable.
    expect(a).toBe(b);
  });

  test('projects rows into both sub-chat and parent-chat id sets', () => {
    const { subChatIds, chatIds } = deriveApprovalIdSets([
      { subChatId: 'sub-1', chatId: 'ws-a' },
      { subChatId: 'sub-2', chatId: 'ws-a' },
      { subChatId: 'sub-3', chatId: 'ws-b' }
    ]);

    // Per-sub-chat consumers (dock tab glyph / promotion) see every sub-chat.
    expect([...subChatIds].sort()).toEqual(['sub-1', 'sub-2', 'sub-3']);
    // Per-workspace consumers (sidebar/kanban dots) see deduped parent chats.
    expect([...chatIds].sort()).toEqual(['ws-a', 'ws-b']);
  });

  test('sidebar (chatIds) and dock (subChatIds) derive from the SAME rows — no cross-surface drift', () => {
    // The whole point of routing every surface through one query: given one row
    // set, the workspace dot and the tab glyph can never disagree.
    const rows = [{ subChatId: 'sub-9', chatId: 'ws-z' }];
    const sets = deriveApprovalIdSets(rows);
    expect(sets.chatIds.has('ws-z')).toBe(true); // sidebar/kanban amber dot
    expect(sets.subChatIds.has('sub-9')).toBe(true); // dock tab needs-input glyph
  });
});
