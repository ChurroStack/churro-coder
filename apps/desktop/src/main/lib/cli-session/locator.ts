/**
 * Locates the on-disk JSONL transcript that a freshly-spawned CLI process is
 * writing into. Used by `terminal.createOrAttach` (post-spawn, fire-and-forget)
 * to remember which file to watch for the ingester.
 *
 * Failure to locate is non-fatal — the conversation pane just stays empty
 * until the user clicks Refresh in the status widget.
 *
 * Path conventions (verified on disk):
 *   Claude: ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *           encoded-cwd = cwd with `/` and `.` replaced by `-`
 *   Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO-ts>-<session-uuid>.jsonl
 *           first line is a `session_meta` event with payload.cwd + payload.id
 */

import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { CliHarness } from '../cli-harness';

const TRACE = '[cli-locator]';

export interface LocatedSession {
  sessionFile: string;
  sessionId: string;
}

export interface LocateOptions {
  harness: CliHarness;
  cwd: string;
  /** Wall-clock ms when the PTY spawn was issued. Files older than this minus
   *  a small grace window are ignored. */
  spawnedAt: number;
}

/** Encode a cwd to Claude's project-dir name. `/` and `.` both become `-`. */
export function encodeClaudeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, '-');
}

function claudeProjectsDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeClaudeProjectDirName(cwd));
}

function codexSessionsRoot(): string {
  return join(homedir(), '.codex', 'sessions');
}

/**
 * Single-shot lookup. Returns null when the file isn't on disk yet.
 * Use {@link locateSessionFile} for the retry-with-backoff wrapper.
 */
export async function locateSessionFileOnce(opts: LocateOptions): Promise<LocatedSession | null> {
  if (opts.harness === 'claude-cli') return locateClaude(opts.cwd, opts.spawnedAt);
  if (opts.harness === 'codex-cli') return locateCodex(opts.cwd, opts.spawnedAt);
  return null;
}

/**
 * Retry up to ~10s. The CLI may not have created its session file by the time
 * we first ask (Codex especially can defer until the first user message).
 *
 * Retries: 0, 250, 500, 1000, 2000, 3000, 3500 ms — total ≈ 10.25s.
 */
export async function locateSessionFile(opts: LocateOptions): Promise<LocatedSession | null> {
  const delays = [0, 250, 500, 1000, 2000, 3000, 3500];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    const found = await locateSessionFileOnce(opts);
    if (found) {
      console.log(
        `${TRACE} located harness=${opts.harness} sub-cwd=${opts.cwd} attempt=${i + 1} file=${found.sessionFile}`
      );
      return found;
    }
  }
  console.warn(`${TRACE} not-found harness=${opts.harness} cwd=${opts.cwd} spawnedAt=${opts.spawnedAt}`);
  return null;
}

// ── Claude ───────────────────────────────────────────────────────────────────

async function locateClaude(cwd: string, spawnedAt: number): Promise<LocatedSession | null> {
  const dir = claudeProjectsDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') console.warn(`${TRACE} claude readdir failed dir=${dir} code=${code}`);
    return null;
  }

  // Collect candidates: *.jsonl modified at or after our spawn time (minus a
  // small grace window for clock skew / FS resolution).
  const grace = 2_000;
  const min = spawnedAt - grace;
  const candidates: { file: string; mtimeMs: number }[] = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const file = join(dir, name);
    try {
      const s = await stat(file);
      if (s.isFile() && s.mtimeMs >= min) {
        candidates.push({ file, mtimeMs: s.mtimeMs });
      }
    } catch {
      /* race with delete; ignore */
    }
  }
  if (candidates.length === 0) return null;

  // Newest first — usually the one we want.
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // A4 mitigation: cwd-encoding can collide (e.g. /Users/a-b/x and /Users/a/b/x
  // both encode to -Users-a-b-x). Confirm by reading the first line of the
  // candidate and checking its `cwd` field. Claude writes cwd into every
  // record; first line is enough.
  for (const cand of candidates) {
    if (await claudeFileMatchesCwd(cand.file, cwd)) {
      const sessionId = baseSessionId(cand.file);
      return { sessionFile: cand.file, sessionId };
    }
  }
  return null;
}

async function claudeFileMatchesCwd(file: string, cwd: string): Promise<boolean> {
  const firstLine = await readFirstLine(file);
  if (!firstLine) return true; // empty file; trust the encoding for now
  try {
    const obj = JSON.parse(firstLine) as { cwd?: string };
    // If the line doesn't carry cwd, fall back to trusting the encoding.
    if (typeof obj.cwd !== 'string') return true;
    return obj.cwd === cwd;
  } catch {
    return true; // unparseable first line — don't reject the candidate over it
  }
}

function baseSessionId(file: string): string {
  const name = file.split('/').pop() ?? file;
  return name.replace(/\.jsonl$/, '');
}

// ── Codex ────────────────────────────────────────────────────────────────────

async function locateCodex(cwd: string, spawnedAt: number): Promise<LocatedSession | null> {
  // Widen the day scan to [D-1, D, D+1] to handle midnight rollovers.
  const root = codexSessionsRoot();
  const days = surroundingDays(new Date(spawnedAt));
  const grace = 2_000;
  const min = spawnedAt - grace;
  const candidates: { file: string; mtimeMs: number }[] = [];

  for (const d of days) {
    const dayDir = join(root, d.year, d.month, d.day);
    let entries: string[];
    try {
      entries = await readdir(dayDir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') console.warn(`${TRACE} codex readdir failed dir=${dayDir} code=${code}`);
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const file = join(dayDir, name);
      try {
        const s = await stat(file);
        if (s.isFile() && s.mtimeMs >= min) candidates.push({ file, mtimeMs: s.mtimeMs });
      } catch {
        /* ignore */
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const cand of candidates) {
    const meta = await readCodexSessionMeta(cand.file);
    if (!meta) continue;
    if (meta.cwd === cwd && meta.id) {
      return { sessionFile: cand.file, sessionId: meta.id };
    }
  }
  return null;
}

interface CodexSessionMeta {
  id: string;
  cwd: string;
}

async function readCodexSessionMeta(file: string): Promise<CodexSessionMeta | null> {
  const line = await readFirstLine(file);
  if (!line) return null;
  try {
    const obj = JSON.parse(line) as {
      type?: string;
      payload?: { id?: string; cwd?: string };
    };
    if (obj.type !== 'session_meta') return null;
    if (typeof obj.payload?.id !== 'string' || typeof obj.payload?.cwd !== 'string') return null;
    return { id: obj.payload.id, cwd: obj.payload.cwd };
  } catch {
    return null;
  }
}

function surroundingDays(d: Date): { year: string; month: string; day: string }[] {
  const dayMs = 86_400_000;
  const ts = d.getTime();
  return [-dayMs, 0, dayMs].map((delta) => {
    const x = new Date(ts + delta);
    return {
      year: String(x.getFullYear()),
      month: pad2(x.getMonth() + 1),
      day: pad2(x.getDate())
    };
  });
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// ── tiny helpers ─────────────────────────────────────────────────────────────

async function readFirstLine(file: string): Promise<string | null> {
  const fh = await open(file, 'r');
  try {
    // 64 KB is generous — Claude/Codex first records are well under this.
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (bytesRead === 0) return null;
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const nl = text.indexOf('\n');
    return nl === -1 ? text : text.slice(0, nl);
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
