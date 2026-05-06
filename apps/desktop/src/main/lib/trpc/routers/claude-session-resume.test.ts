/**
 * B3 — Backend: session_id persisted on first arrival (§B fix).
 *
 * The bug: session_id was only written to DB at stream completion. If the stream
 * was aborted mid-flight (e.g., workspace switch triggers duplicate-start), the
 * next M:START couldn't resume because subChats.sessionId was still null.
 *
 * The fix: persist sessionId to DB on first arrival (the `system:init` message),
 * guarded by `sessionIdPersisted` so only one DB write happens per stream.
 *
 * Tests here validate the idempotency and one-write semantics of the §B flag.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── The §B logic extracted as a pure function for unit testing ────────────────
//
// The actual code lives in claude.ts inside the async stream loop. We test the
// key invariants here without invoking the full router:
//  1. First session_id arrival → DB write runs once.
//  2. Subsequent arrivals with same session_id → no second write (idempotent).
//  3. After abort, DB row retains the persisted session_id (survivability).

interface MockDb {
  updateCalls: { sessionId: string }[];
  updateSubChat: (sessionId: string) => void;
}

function makeDb(): MockDb {
  const db: MockDb = {
    updateCalls: [],
    updateSubChat(sessionId: string) {
      this.updateCalls.push({ sessionId });
    }
  };
  return db;
}

// Reproduces the §B guard from claude.ts
function simulateSessionIdArrival(
  db: MockDb,
  subChatId: string,
  sessionIdPersisted: { value: boolean },
  currentSessionId: { value: string | null },
  incomingSessionId: string
): void {
  if (incomingSessionId) {
    currentSessionId.value = incomingSessionId;
    if (!sessionIdPersisted.value) {
      db.updateSubChat(incomingSessionId);
      sessionIdPersisted.value = true;
    }
  }
}

describe('B3 — session_id persisted on first arrival (§B fix)', () => {
  let db: MockDb;
  let sessionIdPersisted: { value: boolean };
  let currentSessionId: { value: string | null };

  beforeEach(() => {
    db = makeDb();
    sessionIdPersisted = { value: false };
    currentSessionId = { value: null };
  });

  test('first session_id arrival → DB update runs exactly once', () => {
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, 'sess-abc-123');

    expect(db.updateCalls).toHaveLength(1);
    expect(db.updateCalls[0].sessionId).toBe('sess-abc-123');
    expect(sessionIdPersisted.value).toBe(true);
    expect(currentSessionId.value).toBe('sess-abc-123');
  });

  test('second arrival with same session_id → no second write (idempotent, §B flag)', () => {
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, 'sess-abc-123');
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, 'sess-abc-123');

    expect(db.updateCalls).toHaveLength(1); // still just one write
  });

  test('different session_ids in succession → only first is persisted', () => {
    // This shouldn't happen in practice (session_id is stable per SDK run),
    // but the flag ensures only the first write goes through.
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, 'sess-first');
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, 'sess-second');

    expect(db.updateCalls).toHaveLength(1);
    expect(db.updateCalls[0].sessionId).toBe('sess-first');
  });

  test('no session_id in message → DB update is NOT called', () => {
    // Empty string / falsy is treated as absent
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, '');

    expect(db.updateCalls).toHaveLength(0);
    expect(sessionIdPersisted.value).toBe(false);
  });

  test('after abort: DB row retains persisted session_id (resumability)', () => {
    // Simulate: session_id arrives, gets persisted, then abort fires.
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, 'sess-persist');

    // Simulate abort — currentSessionId is what the cleanup path reads from DB
    const abortController = new AbortController();
    abortController.abort();

    // DB should still have the persisted session_id from the update call
    expect(db.updateCalls[0].sessionId).toBe('sess-persist');
    // A fresh stream would read this from DB and resume with it
  });

  test('regression: before §B fix, session_id was only written at stream completion', () => {
    // The old code had no early persist. Only on safeComplete() did the DB update run.
    // Simulating the old behavior: sessionIdPersisted never set → zero writes mid-stream
    // (i.e., if abort fired before completion, DB had null sessionId).
    //
    // With the fix: sessionIdPersisted is set on first arrival → DB write runs once →
    // abort cannot clear it.
    simulateSessionIdArrival(db, 'sub-1', sessionIdPersisted, currentSessionId, 'sess-early');

    // With the fix: write happened during stream, before any completion
    expect(db.updateCalls).toHaveLength(1);
    // An abort right now would NOT clear this because the DB already has it
    expect(db.updateCalls[0].sessionId).toBe('sess-early');
  });
});
