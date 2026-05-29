/**
 * Locator tests. Uses a fake $HOME via a vi.mock of node:os so the locator
 * reads from a temp dir rather than the real ~/.claude / ~/.codex.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fakeHome: string;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => fakeHome };
});

import { encodeClaudeProjectDirName, locateSessionFileOnce, snapshotCodexCandidatePaths } from './locator';

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'cli-locator-test-'));
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

describe('encodeClaudeProjectDirName', () => {
  it('replaces / and . with -', () => {
    expect(encodeClaudeProjectDirName('/Users/aletc1/projects/foo')).toBe('-Users-aletc1-projects-foo');
    expect(encodeClaudeProjectDirName('/Users/aletc1/.churrostack/worktrees/x')).toBe(
      '-Users-aletc1--churrostack-worktrees-x'
    );
  });
});

describe('locator / Claude', () => {
  it('finds the newest .jsonl in the encoded cwd directory', async () => {
    const cwd = '/Users/aletc1/projects/demo';
    const projectDir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });

    const newer = join(projectDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl');
    const older = join(projectDir, '11111111-2222-3333-4444-555555555555.jsonl');
    await writeFile(older, JSON.stringify({ type: 'last-prompt', cwd }) + '\n');
    await writeFile(newer, JSON.stringify({ type: 'last-prompt', cwd }) + '\n');
    // Force the newer file's mtime to be > older's mtime.
    const now = Date.now();
    await utimes(older, new Date(now - 5000) as unknown as Date, new Date(now - 5000) as unknown as Date);
    await utimes(newer, new Date(now) as unknown as Date, new Date(now) as unknown as Date);

    const r = await locateSessionFileOnce({ harness: 'claude-cli', cwd, spawnedAt: now - 6000 });
    expect(r).not.toBeNull();
    expect(r!.sessionFile).toBe(newer);
    expect(r!.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('returns null when the encoded dir does not exist', async () => {
    const r = await locateSessionFileOnce({
      harness: 'claude-cli',
      cwd: '/Users/aletc1/never-existed',
      spawnedAt: Date.now()
    });
    expect(r).toBeNull();
  });

  it('rejects a candidate whose first-line cwd does not match (A4 collision guard)', async () => {
    // Construct an encoding collision: two distinct cwds that encode to the same dir.
    const ours = '/Users/a/b/x';
    const theirs = '/Users/a-b/x'; // both encode to "-Users-a-b-x"
    expect(encodeClaudeProjectDirName(ours)).toBe(encodeClaudeProjectDirName(theirs));

    const projectDir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDirName(ours));
    await mkdir(projectDir, { recursive: true });
    // The newest file belongs to "theirs" — the locator must reject it.
    const wrong = join(projectDir, '99999999-aaaa-bbbb-cccc-dddddddddddd.jsonl');
    await writeFile(wrong, JSON.stringify({ type: 'last-prompt', cwd: theirs }) + '\n');

    const r = await locateSessionFileOnce({ harness: 'claude-cli', cwd: ours, spawnedAt: Date.now() - 1000 });
    expect(r).toBeNull();
  });
});

describe('locator / Claude — deterministic expectedSessionId path', () => {
  // The screenshot regression: a new claude-cli sub-chat is opened in a
  // worktree where an existing claude session is actively streaming. The old
  // mtime-based locator returned the existing session's .jsonl. With
  // --session-id pre-allocation, we know the exact filename and refuse to
  // latch onto anyone else's transcript.
  it('returns ONLY the file at <expectedSessionId>.jsonl, even if a newer unrelated .jsonl exists', async () => {
    const cwd = '/Users/aletc1/projects/demo';
    const projectDir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });

    const expected = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const ourFile = join(projectDir, `${expected}.jsonl`);
    // Another sub-chat's actively streaming transcript, far newer than ours.
    const unrelated = join(projectDir, '99999999-aaaa-bbbb-cccc-dddddddddddd.jsonl');

    await writeFile(ourFile, JSON.stringify({ type: 'last-prompt', cwd }) + '\n');
    await writeFile(unrelated, JSON.stringify({ type: 'last-prompt', cwd }) + '\n');
    const now = Date.now();
    await utimes(ourFile, new Date(now - 10_000) as unknown as Date, new Date(now - 10_000) as unknown as Date);
    await utimes(unrelated, new Date(now) as unknown as Date, new Date(now) as unknown as Date);

    const r = await locateSessionFileOnce({
      harness: 'claude-cli',
      cwd,
      spawnedAt: now - 12_000,
      expectedSessionId: expected
    });
    expect(r).not.toBeNull();
    expect(r!.sessionFile).toBe(ourFile);
    expect(r!.sessionId).toBe(expected);
  });

  it('returns null when only an unrelated .jsonl exists (caller will retry while claude creates ours)', async () => {
    const cwd = '/Users/aletc1/projects/demo';
    const projectDir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });
    const unrelated = join(projectDir, '99999999-aaaa-bbbb-cccc-dddddddddddd.jsonl');
    await writeFile(unrelated, JSON.stringify({ type: 'last-prompt', cwd }) + '\n');

    const r = await locateSessionFileOnce({
      harness: 'claude-cli',
      cwd,
      spawnedAt: Date.now() - 1000,
      expectedSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    });
    expect(r).toBeNull();
  });

  it('skips a candidate whose path is in excludePaths (legacy / fallback scan path)', async () => {
    const cwd = '/Users/aletc1/projects/demo';
    const projectDir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });

    const newer = join(projectDir, 'cccccccc-2222-3333-4444-555555555555.jsonl');
    const older = join(projectDir, 'dddddddd-2222-3333-4444-555555555555.jsonl');
    await writeFile(older, JSON.stringify({ type: 'last-prompt', cwd }) + '\n');
    await writeFile(newer, JSON.stringify({ type: 'last-prompt', cwd }) + '\n');
    const now = Date.now();
    await utimes(older, new Date(now - 5000) as unknown as Date, new Date(now - 5000) as unknown as Date);
    await utimes(newer, new Date(now) as unknown as Date, new Date(now) as unknown as Date);

    const r = await locateSessionFileOnce({
      harness: 'claude-cli',
      cwd,
      spawnedAt: now - 6000,
      excludePaths: new Set([newer]) // pretend newer is bound to another subChat
    });
    expect(r).not.toBeNull();
    expect(r!.sessionFile).toBe(older);
  });
});

describe('locator / Codex', () => {
  it('matches a rollout file by session_meta.payload.cwd', async () => {
    const cwd = '/repo/codex-target';
    const today = new Date();
    const y = today.getUTCFullYear().toString();
    const m = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = today.getUTCDate().toString().padStart(2, '0');
    const dayDir = join(fakeHome, '.codex', 'sessions', y, m, d);
    await mkdir(dayDir, { recursive: true });

    const file = join(dayDir, 'rollout-2026-05-27T00-00-00-019e-mine-uuid.jsonl');
    const sessionMeta = {
      type: 'session_meta',
      payload: { id: 'codex-session-uuid', cwd }
    };
    await writeFile(file, JSON.stringify(sessionMeta) + '\n');

    const r = await locateSessionFileOnce({ harness: 'codex-cli', cwd, spawnedAt: Date.now() - 5000 });
    expect(r).not.toBeNull();
    expect(r!.sessionFile).toBe(file);
    expect(r!.sessionId).toBe('codex-session-uuid');
  });

  it('skips rollout files whose cwd does not match', async () => {
    const cwd = '/repo/target';
    const today = new Date();
    const y = today.getUTCFullYear().toString();
    const m = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = today.getUTCDate().toString().padStart(2, '0');
    const dayDir = join(fakeHome, '.codex', 'sessions', y, m, d);
    await mkdir(dayDir, { recursive: true });

    const file = join(dayDir, 'rollout-foreign.jsonl');
    await writeFile(
      file,
      JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/somewhere/else' } }) + '\n'
    );

    const r = await locateSessionFileOnce({ harness: 'codex-cli', cwd, spawnedAt: Date.now() - 5000 });
    expect(r).toBeNull();
  });

  it('existingPaths excludes pre-existing rollouts (pre-spawn snapshot)', async () => {
    const cwd = '/repo/codex-multi';
    const today = new Date();
    const y = today.getUTCFullYear().toString();
    const m = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = today.getUTCDate().toString().padStart(2, '0');
    const dayDir = join(fakeHome, '.codex', 'sessions', y, m, d);
    await mkdir(dayDir, { recursive: true });

    // "Pre-existing" rollout (would otherwise be the newest match).
    const preExisting = join(dayDir, 'rollout-pre-2026-05-29-existing-uuid.jsonl');
    await writeFile(
      preExisting,
      JSON.stringify({ type: 'session_meta', payload: { id: 'existing-uuid', cwd } }) + '\n'
    );

    // Snapshot taken BEFORE codex spawned (captures preExisting).
    const snap = await snapshotCodexCandidatePaths(Date.now());
    expect(snap.has(preExisting)).toBe(true);

    // The "new" rollout codex creates after our spawn.
    const fresh = join(dayDir, 'rollout-new-2026-05-29-fresh-uuid.jsonl');
    await writeFile(fresh, JSON.stringify({ type: 'session_meta', payload: { id: 'fresh-uuid', cwd } }) + '\n');

    const r = await locateSessionFileOnce({
      harness: 'codex-cli',
      cwd,
      spawnedAt: Date.now() - 1000,
      existingPaths: snap
    });
    expect(r).not.toBeNull();
    expect(r!.sessionId).toBe('fresh-uuid');
    expect(r!.sessionFile).toBe(fresh);
  });

  it('skips a codex candidate whose path is in excludePaths', async () => {
    const cwd = '/repo/codex-race';
    const today = new Date();
    const y = today.getUTCFullYear().toString();
    const m = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = today.getUTCDate().toString().padStart(2, '0');
    const dayDir = join(fakeHome, '.codex', 'sessions', y, m, d);
    await mkdir(dayDir, { recursive: true });

    const claimedByA = join(dayDir, 'rollout-a.jsonl');
    const ours = join(dayDir, 'rollout-b.jsonl');
    await writeFile(claimedByA, JSON.stringify({ type: 'session_meta', payload: { id: 'a', cwd } }) + '\n');
    await writeFile(ours, JSON.stringify({ type: 'session_meta', payload: { id: 'b', cwd } }) + '\n');
    const now = Date.now();
    // claimedByA is newer — without excludePaths, locator would return it.
    await utimes(ours, new Date(now - 5000) as unknown as Date, new Date(now - 5000) as unknown as Date);
    await utimes(claimedByA, new Date(now) as unknown as Date, new Date(now) as unknown as Date);

    const r = await locateSessionFileOnce({
      harness: 'codex-cli',
      cwd,
      spawnedAt: now - 6000,
      excludePaths: new Set([claimedByA])
    });
    expect(r).not.toBeNull();
    expect(r!.sessionId).toBe('b');
  });
});
