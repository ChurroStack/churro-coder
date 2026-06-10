/**
 * Time/billing rollup scheduler. Single source of truth that all callers
 * (startup, the interval, and the `time.refresh` mutation) funnel through.
 *
 * Concurrency: a coalescing in-flight promise (the same pattern used by the MCP
 * HTTP server init) ensures the runtime rebuild and the token recompute — both
 * of which delete+reinsert ledger rows — never overlap across the main
 * process's windows.
 *
 * Both rollups attribute usage to projects by cwd (terminal usage included), so
 * they read the SAME JSONLs. We walk the trees ONCE here, feed the file list to
 * the readers (no second traversal), and gate the heavy read+rebuild behind a
 * freshness signature that folds in BOTH the file fingerprint (count + newest
 * mtime) AND a content fingerprint of the attribution inputs (so a project
 * rename / backfilled session id re-attributes even when no file changed).
 */
import { stat } from 'node:fs/promises';
import { listClaudeUsageFiles, readClaudeUsage } from '../usage/claude-reader';
import { listCodexUsageFiles, readCodexUsage } from '../usage/codex-reader';
import { loadProjectIndex, loadSessionMap, loadBuiltinSessionIds, attributionFingerprint } from './project-resolver';
import { recoverOpenIntervals } from './runtime-rollup';
import { rollupUsageRuntime } from './usage-runtime';
import { rollupTokenDaily } from './token-rollup';

const TRACE = '[time-rollup]';
const INTERVAL_MS = 3 * 60_000;

let inFlight: Promise<void> | null = null;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastSignature: string | null = null;

/** Newest mtime across the files, stat'd in parallel. 0 if none are readable. */
async function newestMtime(files: string[]): Promise<number> {
  const mtimes = await Promise.all(
    files.map((f) =>
      stat(f)
        .then((s) => s.mtimeMs)
        .catch(() => 0)
    )
  );
  let max = 0;
  for (const m of mtimes) if (m > max) max = m;
  return max;
}

/** Run both rollups once. Concurrent callers share the same in-flight run. */
export function runRollups(force = false): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const index = loadProjectIndex();
      const sessionMap = loadSessionMap();
      const builtinSessions = loadBuiltinSessionIds();

      // One walk of each tree; reused for both the signature and the readers.
      const claudeFiles = await listClaudeUsageFiles();
      const codexFiles = await listCodexUsageFiles();
      const allFiles = [...claudeFiles, ...codexFiles];
      const maxMtime = await newestMtime(allFiles);
      const signature = `${allFiles.length}:${Math.round(maxMtime)}:${attributionFingerprint(index, sessionMap)}`;
      if (!force && signature === lastSignature) return;

      const [claude, codex] = await Promise.all([readClaudeUsage(null, claudeFiles), readCodexUsage(null, codexFiles)]);
      const entries = [...claude, ...codex];

      // Runtime (derived intervals) + spend (token_daily), one scan, same scope.
      rollupUsageRuntime(entries, index, sessionMap, builtinSessions);
      rollupTokenDaily(entries, index, sessionMap);

      lastSignature = signature;
    } catch (err) {
      console.warn(`${TRACE} runRollups failed`, err);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Call once after DB init at app startup. */
export function startTimeTracking(): void {
  if (started) return;
  started = true;
  // Close any live interval orphaned by a crash BEFORE new turns can open.
  recoverOpenIntervals();
  // Defer the first heavy rollup (JSONL parse + ledger rebuild) off the startup
  // critical path so it doesn't block window creation; the UI shows cached/empty
  // until it lands.
  setImmediate(() => void runRollups());
  timer = setInterval(() => void runRollups(), INTERVAL_MS);
  // Don't keep the event loop alive for this background timer.
  timer.unref?.();
}

export function stopTimeTracking(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
