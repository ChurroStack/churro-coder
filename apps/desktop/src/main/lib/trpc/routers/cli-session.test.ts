/**
 * End-to-end isolation tests for `postSpawnLocateAndAttach`.
 *
 * The regression these tests pin: a new claude-cli sub-chat in a worktree
 * where another claude-cli sub-chat is already active must NOT inherit the
 * other sub-chat's `cliSessionId` / `cliSessionFile`. Before the fix, the
 * locator's mtime-based scan latched onto the actively-streaming transcript
 * of whatever Claude was already running. See `apps/desktop/CLAUDE.md`
 * § Per-subChat isolation invariant.
 *
 * Uses real `better-sqlite3` in-memory + drizzle so the transaction-based
 * collision check in `persistLocatedSession` exercises the same code path
 * production hits. The chokidar-backed ingester is stubbed — we only care
 * that the right (sessionId, sessionFile) lands on the right sub-chat row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// better-sqlite3 is a native module. CI installs with SKIP_ELECTRON_REBUILD=1
// so the prebuilt Node-ABI binary stays in place and these tests run normally.
// Local dev after `bun install` (which fires electron-rebuild) ends up with
// an Electron-ABI binary that vitest's Node runtime can't load — in that case
// we skip with a clear message rather than fail. Rebuild for Node tests with
// `bunx node-gyp rebuild` inside node_modules/better-sqlite3.
let nativeSqliteUsable = true;
let nativeSqliteSkipReason = '';
try {
  new Database(':memory:').close();
} catch (err) {
  nativeSqliteUsable = false;
  const msg = err instanceof Error ? err.message : String(err);
  nativeSqliteSkipReason = msg.split('\n')[0];
  // Direct stderr write bypasses vitest's --silent flag (which suppresses
  // console.warn during the test run), so the skip reason is always visible
  // in CI logs and local test output.
  process.stderr.write(
    `\n[cli-session.test] SKIPPING native-sqlite e2e tests — ${nativeSqliteSkipReason}\n` +
      `   To run them locally: \`bunx node-gyp rebuild\` inside apps/desktop/node_modules/better-sqlite3\n` +
      `   (CI runs with SKIP_ELECTRON_REBUILD=1 so the Node-ABI prebuilt stays put.)\n\n`
  );
}

let fakeHome: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

// trpc/index.ts pulls in analytics.ts which loads @sentry/electron/main.
// We don't exercise the trpc machinery directly — `postSpawnLocateAndAttach`
// is a plain exported function — but the import chain still has to resolve.
// Stubbing analytics short-circuits the sentry/electron loader.
vi.mock('../../analytics', () => ({
  captureError: vi.fn(),
  redactUnknown: (x: unknown) => x
}));
vi.mock('electron', () => ({
  app: { getPath: () => fakeHome, isPackaged: false }
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => fakeHome };
});

vi.mock('../../db', () => ({
  getDatabase: () => db
}));

// Ingester runs chokidar + file IO; stub it so tests stay fast and pure.
// `attachIngester` is the only function `postSpawnLocateAndAttach` calls.
const { attachIngesterMock } = vi.hoisted(() => ({
  attachIngesterMock: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../cli-session/ingester', () => ({
  attachIngester: attachIngesterMock,
  detachIngester: vi.fn().mockResolvedValue(undefined),
  getIngester: vi.fn().mockReturnValue(null),
  onCliSessionIngest: vi.fn().mockReturnValue(() => {})
}));

import { postSpawnLocateAndAttach, ensureIngesterAttached, bootstrapIngestersOnAppStart } from './cli-session';
import { encodeClaudeProjectDirName } from '../../cli-session/locator';
import { subChats, chats, projects } from '../../db/schema';

const WORKTREE = '/Users/aletc1/projects/demo';

async function makeClaudeJsonl(sessionId: string, cwd = WORKTREE): Promise<string> {
  const dir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDirName(cwd));
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  await writeFile(file, JSON.stringify({ type: 'summary', cwd }) + '\n');
  return file;
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'cli-session-iso-test-'));
  sqlite = new Database(':memory:');
  db = drizzle(sqlite);

  // Minimal DDL — covers every column read/written by cli-session.ts. We
  // bypass the migrations folder because the locator never touches anything
  // else and bringing migrations into a test loop is brittle (path-dependent
  // on app.isPackaged).
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at INTEGER,
      updated_at INTEGER,
      git_remote_url TEXT,
      git_provider TEXT,
      git_owner TEXT,
      git_repo TEXT,
      git_project TEXT,
      icon_path TEXT,
      sandbox_enabled INTEGER
    );
    CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      project_id TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      archived_at INTEGER,
      worktree_path TEXT,
      branch TEXT,
      base_branch TEXT,
      pr_url TEXT,
      pr_number INTEGER,
      sandbox_enabled INTEGER,
      openspec_tools TEXT
    );
    CREATE TABLE sub_chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      chat_id TEXT NOT NULL,
      session_id TEXT,
      session_mode TEXT,
      stream_id TEXT,
      mode TEXT NOT NULL DEFAULT 'plan',
      openspec_change_id TEXT,
      harness TEXT NOT NULL DEFAULT 'builtin',
      file_stats_additions INTEGER NOT NULL DEFAULT 0,
      file_stats_deletions INTEGER NOT NULL DEFAULT 0,
      file_stats_file_count INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_idx INTEGER,
      bootstrapped_at INTEGER,
      cli_session_id TEXT,
      cli_session_file TEXT,
      cli_session_detected_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  db.insert(projects).values({ id: 'p1', name: 'demo', path: WORKTREE }).run();
  db.insert(chats).values({ id: 'chat-1', projectId: 'p1', worktreePath: WORKTREE }).run();

  // Reset impl + history. `restoreAllMocks` (in afterEach) wipes the
  // `mockResolvedValue` we configured at hoist time, so re-arm it here.
  attachIngesterMock.mockReset();
  attachIngesterMock.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  sqlite?.close();
  await rm(fakeHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function seedSubChat(opts: {
  id: string;
  cliSessionId?: string | null;
  cliSessionFile?: string | null;
  messageCount?: number;
}): void {
  db.insert(subChats)
    .values({
      id: opts.id,
      chatId: 'chat-1',
      harness: 'claude-cli',
      mode: 'execute',
      cliSessionId: opts.cliSessionId ?? null,
      cliSessionFile: opts.cliSessionFile ?? null,
      messageCount: opts.messageCount ?? 0
    })
    .run();
}

function readSubChatBinding(id: string) {
  return db
    .select({
      cliSessionId: subChats.cliSessionId,
      cliSessionFile: subChats.cliSessionFile
    })
    .from(subChats)
    .where(eq(subChats.id, id))
    .get();
}

// Title includes the skip reason when applicable so the test runner's output
// names *why* the suite was skipped, not just "1 skipped".
const suiteTitle = nativeSqliteUsable
  ? 'postSpawnLocateAndAttach — claude-cli sub-chat isolation'
  : `postSpawnLocateAndAttach — SKIPPED (better-sqlite3 ABI mismatch: ${nativeSqliteSkipReason})`;
describe.skipIf(!nativeSqliteUsable)(suiteTitle, () => {
  /**
   * The screenshot bug, end-to-end. Without the fix, sub-chat B would inherit
   * sub-chat A's session id and the ingester would replay A's transcript into
   * B's messages table.
   */
  it("never reuses another claude-cli sub-chat's cliSessionFile (existing-active + new-spawn)", async () => {
    const idA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const fileA = await makeClaudeJsonl(idA);
    seedSubChat({ id: 'A', cliSessionId: idA, cliSessionFile: fileA, messageCount: 5 });

    // Sub-chat B simulates a fresh spawn: `buildCliBootstrap` would have
    // pre-allocated cliSessionId, so we seed that. claude (with --session-id)
    // would then create B's jsonl at the predictable path.
    const idB = '11111111-2222-3333-4444-555555555555';
    seedSubChat({ id: 'B', cliSessionId: idB });
    const fileB = await makeClaudeJsonl(idB);

    await postSpawnLocateAndAttach('B', Date.now());

    const bound = readSubChatBinding('B');
    expect(bound?.cliSessionId).toBe(idB);
    expect(bound?.cliSessionFile).toBe(fileB);
    // Crucial: B did not steal A's file.
    expect(bound?.cliSessionFile).not.toBe(fileA);
    expect(attachIngesterMock).toHaveBeenCalledWith('B', 'claude-cli', fileB);

    // A's binding is untouched.
    const boundA = readSubChatBinding('A');
    expect(boundA?.cliSessionId).toBe(idA);
    expect(boundA?.cliSessionFile).toBe(fileA);
  });

  it('two concurrent fresh claude-cli sub-chats end up with distinct cliSessionFiles', async () => {
    const idA = '22222222-aaaa-bbbb-cccc-dddddddddddd';
    const idB = '33333333-aaaa-bbbb-cccc-dddddddddddd';
    seedSubChat({ id: 'A', cliSessionId: idA });
    seedSubChat({ id: 'B', cliSessionId: idB });
    const fileA = await makeClaudeJsonl(idA);
    const fileB = await makeClaudeJsonl(idB);
    const now = Date.now();

    await Promise.all([postSpawnLocateAndAttach('A', now), postSpawnLocateAndAttach('B', now)]);

    const boundA = readSubChatBinding('A');
    const boundB = readSubChatBinding('B');
    expect(boundA?.cliSessionFile).toBe(fileA);
    expect(boundB?.cliSessionFile).toBe(fileB);
    expect(boundA?.cliSessionFile).not.toBe(boundB?.cliSessionFile);
  });

  // Legacy row (no pre-allocated id) — exercises the fallback scan path with
  // excludePaths plumbed in. The locator backs off for ~10 s when no candidate
  // matches; vitest's fake timers can't cleanly drain its nested
  // `await sleep(...)` chain when each iteration also does real fs I/O, so we
  // accept the wall-clock cost and bump the timeout. The locator-level
  // "skips a candidate whose path is in excludePaths" test in
  // `cli-session/locator.test.ts` covers the same invariant in ~5 ms.
  it('refuses to bind when the only jsonl in the dir belongs to another sub-chat (no pre-allocated id)', async () => {
    const idA = '44444444-aaaa-bbbb-cccc-dddddddddddd';
    const fileA = await makeClaudeJsonl(idA);
    seedSubChat({ id: 'A', cliSessionId: idA, cliSessionFile: fileA, messageCount: 1 });

    seedSubChat({ id: 'B' /* cliSessionId left null on purpose */ });
    // No new file for B yet (simulates "claude hasn't written first message").

    await postSpawnLocateAndAttach('B', Date.now());

    const bound = readSubChatBinding('B');
    expect(bound?.cliSessionFile).toBeNull();
    expect(bound?.cliSessionId).toBeNull();
    expect(attachIngesterMock).not.toHaveBeenCalledWith('B', expect.anything(), expect.anything());
  }, 15_000);
});

const ensureTitle = nativeSqliteUsable
  ? 'ensureIngesterAttached — deterministic orphaned-row recovery'
  : `ensureIngesterAttached — SKIPPED (better-sqlite3 ABI mismatch: ${nativeSqliteSkipReason})`;
describe.skipIf(!nativeSqliteUsable)(ensureTitle, () => {
  // The bug this pins: a claude-cli sub-chat whose cliSessionFile was never
  // persisted (the post-spawn locator missed its single shot) stays empty
  // forever. Its transcript is deterministically locatable from cliSessionId.
  it('recovers a null-file claude-cli row when the deterministic transcript exists', async () => {
    const idB = 'b93a36ff-f760-402c-8851-8f8a271d3977';
    seedSubChat({ id: 'B', cliSessionId: idB /* cliSessionFile null */ });
    const fileB = await makeClaudeJsonl(idB);

    const res = await ensureIngesterAttached('B');

    expect(res.via).toBe('recovered');
    expect(res.attached).toBe(true);
    expect(res.sessionFile).toBe(fileB);
    expect(attachIngesterMock).toHaveBeenCalledWith('B', 'claude-cli', fileB);
    // The binding is now persisted so app-start / future opens re-attach directly.
    const bound = readSubChatBinding('B');
    expect(bound?.cliSessionFile).toBe(fileB);
    expect(bound?.cliSessionId).toBe(idB);
  });

  // A1 from the plan critique: the auto path must be deterministic-only. With no
  // cliSessionId it must NOT mtime-scan, even when a foreign transcript is the
  // newest file in the same encoded-cwd dir (which a scan would latch onto).
  it('does NOT attach or mtime-scan when cliSessionId is null', async () => {
    // A foreign sub-chat's freshly-written transcript sits in the same dir.
    await makeClaudeJsonl('cccccccc-aaaa-bbbb-cccc-dddddddddddd');
    seedSubChat({ id: 'B' /* cliSessionId null, cliSessionFile null */ });

    const res = await ensureIngesterAttached('B');

    expect(res.via).toBe('none');
    expect(res.attached).toBe(false);
    expect(res.sessionFile).toBeNull();
    expect(attachIngesterMock).not.toHaveBeenCalled();
    expect(readSubChatBinding('B')?.cliSessionFile).toBeNull();
  });

  it('no-ops (does not throw) when the deterministic transcript is not yet on disk', async () => {
    seedSubChat({ id: 'B', cliSessionId: 'dddddddd-aaaa-bbbb-cccc-dddddddddddd' });
    // No file written — single-shot lookup returns null immediately (no ~10s hang).
    const res = await ensureIngesterAttached('B');
    expect(res.via).toBe('none');
    expect(res.attached).toBe(false);
    expect(attachIngesterMock).not.toHaveBeenCalled();
  });

  it('bootstrapIngestersOnAppStart recovers orphaned rows (null cliSessionFile + id + on-disk transcript)', async () => {
    const idB = 'eeeeeeee-aaaa-bbbb-cccc-dddddddddddd';
    seedSubChat({ id: 'B', cliSessionId: idB /* cliSessionFile null */ });
    const fileB = await makeClaudeJsonl(idB);

    await bootstrapIngestersOnAppStart();

    expect(attachIngesterMock).toHaveBeenCalledWith('B', 'claude-cli', fileB);
    expect(readSubChatBinding('B')?.cliSessionFile).toBe(fileB);
  });
});
