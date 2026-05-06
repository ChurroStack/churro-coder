import { describe, expect, test } from 'vitest';
import { inferSubChatModeForHydration, persistSubChatRunMode, repairSubChatModeForHydration } from './sub-chat-mode';

function createDbMock() {
  const calls: Array<{ patch: unknown; ran: boolean }> = [];
  const db = {
    update: () => ({
      set: (patch: unknown) => ({
        where: () => ({
          run: () => {
            calls.push({ patch, ran: true });
          }
        })
      })
    })
  };

  return { db, calls };
}

function messagesWithTool(type: string, filePath: string) {
  return JSON.stringify([
    {
      role: 'assistant',
      parts: [{ type, input: { file_path: filePath } }]
    }
  ]);
}

describe('persistSubChatRunMode', () => {
  test('does not write when persisted mode already matches stream mode', () => {
    const { db, calls } = createDbMock();

    const changed = persistSubChatRunMode({
      db,
      subChatId: 'sub-1',
      existingMode: 'agent',
      inputMode: 'agent'
    });

    expect(changed).toBe(false);
    expect(calls).toEqual([]);
  });

  test('writes the stream mode when persisted mode is stale', () => {
    const { db, calls } = createDbMock();

    const changed = persistSubChatRunMode({
      db,
      subChatId: 'sub-1',
      existingMode: 'plan',
      inputMode: 'agent'
    });

    expect(changed).toBe(true);
    expect(calls).toEqual([{ patch: { mode: 'agent' }, ran: true }]);
  });

  test('skips the write when the row was not found (existingMode is nullish)', () => {
    const { db, calls } = createDbMock();

    const changedNull = persistSubChatRunMode({
      db,
      subChatId: 'sub-1',
      existingMode: null,
      inputMode: 'agent'
    });
    const changedUndef = persistSubChatRunMode({
      db,
      subChatId: 'sub-1',
      existingMode: undefined,
      inputMode: 'plan'
    });

    expect(changedNull).toBe(false);
    expect(changedUndef).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('inferSubChatModeForHydration', () => {
  test('repairs stale plan mode when the run session was agent mode', () => {
    expect(inferSubChatModeForHydration({ mode: 'plan', sessionMode: 'agent' })).toBe('agent');
  });

  test('repairs stale plan mode when assistant edited a non-plan file', () => {
    expect(
      inferSubChatModeForHydration({
        mode: 'plan',
        messages: messagesWithTool('tool-Edit', '/repo/styles.css')
      })
    ).toBe('agent');
  });

  test('keeps plan mode when the only file edit is a plan-store file', () => {
    expect(
      inferSubChatModeForHydration({
        mode: 'plan',
        messages: messagesWithTool(
          'tool-Write',
          '/Users/u/Library/Application Support/Churro Coder/sub-chats/sub-1/plans/current.md'
        )
      })
    ).toBe('plan');
  });

  test('keeps plan mode for legacy claude-sessions plan-store paths', () => {
    expect(
      inferSubChatModeForHydration({
        mode: 'plan',
        messages: messagesWithTool('tool-Write', '/tmp/claude-sessions/sub/plans/plan.md')
      })
    ).toBe('plan');
  });

  test('treats user-owned `*plan*.md` project files as agent edits', () => {
    expect(
      inferSubChatModeForHydration({
        mode: 'plan',
        messages: messagesWithTool('tool-Edit', '/repo/docs/release-plan.md')
      })
    ).toBe('agent');
  });
});

describe('repairSubChatModeForHydration', () => {
  test('updates stale rows and returns the repaired row', () => {
    const { db, calls } = createDbMock();

    const row = repairSubChatModeForHydration(db, {
      id: 'sub-1',
      mode: 'plan',
      sessionMode: null,
      messages: messagesWithTool('tool-Write', '/repo/index.html')
    });

    expect(row.mode).toBe('agent');
    expect(calls).toEqual([{ patch: { mode: 'agent' }, ran: true }]);
  });
});
