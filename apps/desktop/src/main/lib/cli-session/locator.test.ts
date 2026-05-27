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

import { encodeClaudeProjectDirName, locateSessionFileOnce } from './locator';

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
});
