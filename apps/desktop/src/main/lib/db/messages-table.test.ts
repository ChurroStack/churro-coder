// TODO(claim-merge): these tests are *behavioral mocks* of a drizzle query
// chain. They verify the production code's branching logic (when the SELECT
// fires, when UPDATE is chosen over INSERT, what `null` vs `idx` is returned)
// but cannot catch a SQL-clause bug (wrong WHERE column, wrong UPDATE patch).
// End-to-end SQL coverage would require an in-process better-sqlite3 instance,
// which currently fails locally on Node versions whose ABI differs from the
// electron-rebuild target. If that gap matters, gate a real-DB variant on
// `process.versions.modules` matching the installed better_sqlite3.node ABI
// so CI exercises the SQL path while local devs aren't blocked by the rebuild.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// part-spill (used by processPartsForStorage on the insert path) reads
// app.getPath. None of our test payloads exceed the spill threshold, so
// the function returns the part unchanged — but the module-level
// `import { app } from 'electron'` still needs to resolve.
let tmpRoot: string;
vi.mock('electron', () => ({ app: { getPath: () => tmpRoot } }));

import { appendIngestedMessage, escapeLikePattern } from './messages-table';

interface StoredRow {
  subChatId: string;
  idx: number;
  id: string;
  role: string;
  parts: string;
  metadata: string | null;
  createdAt: Date;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'messages-table-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Minimal drizzle-compatible behavioral mock.
 *
 * Implements only the call shapes `appendIngestedMessage` exercises:
 *   - db.transaction((tx) => ...)             ← claim-merge wrapper
 *   - db.select({...}).from(...).where(...).get()
 *   - db.update(...).set({...}).where(...).run()
 *   - db.insert(...).values({...}).onConflictDoNothing().run()
 *
 * `where()` clauses are opaque SQL ASTs in drizzle; the mock instead consults
 * an explicit `armPriorLookup(subChatId, idx)` set by each test to identify
 * which row a SELECT or UPDATE should target. Production code only filters by
 * (subChatId, idx) here, so this single hook captures the right semantics.
 *
 * `selectFiredFor()` exposes the idx the most recent SELECT fired on (or -1 if
 * the SELECT path never ran) — used to assert that the role/idx guards
 * short-circuit before reaching the DB.
 */
function makeBehaviorMockDb() {
  const rows: StoredRow[] = [];
  const lookupByPriorIdx: { subChatId: string; idx: number } = { subChatId: '', idx: -1 };
  let lastSelectFiredAtIdx = -1;

  const select = (_columns?: unknown) => ({
    from: (_table: unknown) => ({
      where: (_clause: unknown) => ({
        get: () => {
          lastSelectFiredAtIdx = lookupByPriorIdx.idx;
          return rows.find((r) => r.subChatId === lookupByPriorIdx.subChatId && r.idx === lookupByPriorIdx.idx);
        }
      })
    })
  });

  const update = (_table: unknown) => ({
    set: (patch: Partial<StoredRow>) => ({
      where: (_clause: unknown) => ({
        run: () => {
          const target = rows.find((r) => r.subChatId === lookupByPriorIdx.subChatId && r.idx === lookupByPriorIdx.idx);
          if (!target) return { changes: 0 };
          Object.assign(target, patch);
          return { changes: 1 };
        }
      })
    })
  });

  const insert = (_table: unknown) => ({
    values: (v: {
      subChatId: string;
      idx: number;
      id: string;
      role: string;
      parts: string;
      metadata: string | null;
      createdAt: Date;
    }) => ({
      onConflictDoNothing: () => ({
        run: () => {
          const conflict = rows.some((r) => r.subChatId === v.subChatId && (r.id === v.id || r.idx === v.idx));
          if (conflict) return { changes: 0 };
          rows.push({
            subChatId: v.subChatId,
            idx: v.idx,
            id: v.id,
            role: v.role,
            parts: v.parts,
            metadata: v.metadata,
            createdAt: v.createdAt
          });
          return { changes: 1 };
        }
      })
    })
  });

  const armPriorLookup = (subChatId: string, idx: number) => {
    lookupByPriorIdx.subChatId = subChatId;
    lookupByPriorIdx.idx = idx;
    lastSelectFiredAtIdx = -1;
  };

  const db: {
    select: typeof select;
    update: typeof update;
    insert: typeof insert;
    transaction: <T>(fn: (tx: unknown) => T) => T;
  } = {
    select,
    update,
    insert,
    transaction: (fn) => fn(db)
  };

  return {
    rows,
    armPriorLookup,
    selectFiredFor: () => lastSelectFiredAtIdx,
    db: db as unknown as never
  };
}

function seed(rows: StoredRow[], row: Omit<StoredRow, 'metadata' | 'createdAt'> & { metadata?: string | null }) {
  rows.push({ ...row, metadata: row.metadata ?? null, createdAt: new Date() });
}

describe('appendIngestedMessage — claim-merge', () => {
  it('claims the optimistic msg-* row when the incoming user text matches', () => {
    const mock = makeBehaviorMockDb();
    seed(mock.rows, {
      subChatId: 'sub-1',
      idx: 0,
      id: 'msg-1779894767725',
      role: 'user',
      parts: JSON.stringify([{ type: 'text', text: 'cambia el fondo a fuscia' }])
    });
    mock.armPriorLookup('sub-1', 0);

    const result = appendIngestedMessage(mock.db, 'sub-1', 1, {
      id: 'ffa70561-1a37-40ef-af83-642733da7381',
      role: 'user',
      parts: [{ type: 'text', text: 'cambia el fondo a fuscia' }],
      createdAt: Date.now()
    });

    expect(result).toBeNull();
    expect(mock.rows).toHaveLength(1);
    expect(mock.rows[0].idx).toBe(0);
    expect(mock.rows[0].id).toBe('ffa70561-1a37-40ef-af83-642733da7381');
    expect(JSON.parse(mock.rows[0].parts)).toEqual([{ type: 'text', text: 'cambia el fondo a fuscia' }]);
  });

  it('tolerates leading/trailing whitespace differences', () => {
    const mock = makeBehaviorMockDb();
    seed(mock.rows, {
      subChatId: 'sub-1',
      idx: 0,
      id: 'msg-1779894767725',
      role: 'user',
      parts: JSON.stringify([{ type: 'text', text: '  hi there  ' }])
    });
    mock.armPriorLookup('sub-1', 0);

    const result = appendIngestedMessage(mock.db, 'sub-1', 1, {
      id: 'jsonl-uuid-1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi there\n' }],
      createdAt: Date.now()
    });

    expect(result).toBeNull();
    expect(mock.rows[0].id).toBe('jsonl-uuid-1');
  });

  it('inserts normally when text does not match', () => {
    const mock = makeBehaviorMockDb();
    seed(mock.rows, {
      subChatId: 'sub-1',
      idx: 0,
      id: 'msg-1779894767725',
      role: 'user',
      parts: JSON.stringify([{ type: 'text', text: 'first prompt' }])
    });
    mock.armPriorLookup('sub-1', 0);

    const result = appendIngestedMessage(mock.db, 'sub-1', 1, {
      id: 'jsonl-uuid-2',
      role: 'user',
      parts: [{ type: 'text', text: 'different prompt' }],
      createdAt: Date.now()
    });

    expect(result).toBe(1);
    expect(mock.rows).toHaveLength(2);
    expect(mock.rows[0].id).toBe('msg-1779894767725');
    expect(mock.rows[1].id).toBe('jsonl-uuid-2');
  });

  it('does not claim when the prior id is not msg-<digits>', () => {
    const mock = makeBehaviorMockDb();
    seed(mock.rows, {
      subChatId: 'sub-1',
      idx: 0,
      id: 'fork-1234-0-abc',
      role: 'user',
      parts: JSON.stringify([{ type: 'text', text: 'forked prompt' }])
    });
    mock.armPriorLookup('sub-1', 0);

    const result = appendIngestedMessage(mock.db, 'sub-1', 1, {
      id: 'jsonl-uuid-3',
      role: 'user',
      parts: [{ type: 'text', text: 'forked prompt' }],
      createdAt: Date.now()
    });

    expect(result).toBe(1);
    expect(mock.rows).toHaveLength(2);
    expect(mock.rows[0].id).toBe('fork-1234-0-abc');
  });

  it('does not claim when the prior row is an assistant message', () => {
    const mock = makeBehaviorMockDb();
    seed(mock.rows, {
      subChatId: 'sub-1',
      idx: 0,
      id: 'msg-1779894767725',
      role: 'assistant',
      parts: JSON.stringify([{ type: 'text', text: 'hello' }])
    });
    mock.armPriorLookup('sub-1', 0);

    const result = appendIngestedMessage(mock.db, 'sub-1', 1, {
      id: 'jsonl-uuid-4',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: Date.now()
    });

    expect(result).toBe(1);
    expect(mock.rows).toHaveLength(2);
  });

  it('does not run claim-merge when the incoming message is an assistant', () => {
    const mock = makeBehaviorMockDb();
    seed(mock.rows, {
      subChatId: 'sub-1',
      idx: 0,
      id: 'msg-1779894767725',
      role: 'user',
      parts: JSON.stringify([{ type: 'text', text: 'hello' }])
    });
    mock.armPriorLookup('sub-1', 0);

    const result = appendIngestedMessage(mock.db, 'sub-1', 1, {
      id: 'jsonl-uuid-5',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: Date.now()
    });

    expect(result).toBe(1);
    expect(mock.rows).toHaveLength(2);
    // Critically: the SELECT(prior row) probe must not have fired for an
    // assistant insert — the guard skips it before reaching DB.
    expect(mock.selectFiredFor()).toBe(-1);
  });

  it('does not look up a prior row at idx=0', () => {
    const mock = makeBehaviorMockDb();
    mock.armPriorLookup('sub-1', -1); // sentinel — should never be read

    const result = appendIngestedMessage(mock.db, 'sub-1', 0, {
      id: 'jsonl-uuid-6',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: Date.now()
    });

    expect(result).toBe(0);
    expect(mock.rows).toHaveLength(1);
    expect(mock.rows[0].id).toBe('jsonl-uuid-6');
    expect(mock.selectFiredFor()).toBe(-1);
  });

  it('warns and falls through to insert when the prior row parts JSON is malformed', () => {
    const mock = makeBehaviorMockDb();
    seed(mock.rows, {
      subChatId: 'sub-1',
      idx: 0,
      id: 'msg-1779894767725',
      role: 'user',
      parts: '{not valid json'
    });
    mock.armPriorLookup('sub-1', 0);
    const warn = vi.spyOn(console, 'warn');

    const result = appendIngestedMessage(mock.db, 'sub-1', 1, {
      id: 'jsonl-uuid-7',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: Date.now()
    });

    expect(result).toBe(1);
    expect(mock.rows).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('claim-merge: malformed prior parts JSON sub=sub-1 idx=0'),
      expect.anything()
    );
  });
});

describe('escapeLikePattern', () => {
  it('escapes the LIKE wildcards `_` and `%` and the escape char `\\`', () => {
    // tool-call ids contain `_`, which is a single-char LIKE wildcard.
    expect(escapeLikePattern('toolu_01ABC')).toBe('toolu\\_01ABC');
    expect(escapeLikePattern('call_a_b')).toBe('call\\_a\\_b');
    expect(escapeLikePattern('a%b')).toBe('a\\%b');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('leaves wildcard-free ids untouched', () => {
    expect(escapeLikePattern('toolu01ABC')).toBe('toolu01ABC');
    expect(escapeLikePattern('')).toBe('');
  });

  it('builds a literal substring pattern (the `_` is escaped, not a wildcard)', () => {
    expect(`%${escapeLikePattern('toolu_01')}%`).toBe('%toolu\\_01%');
  });
});
