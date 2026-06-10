/**
 * Pure runtime-reconstruction helpers. No DB, no Electron — unit-tested.
 *
 * Runtime is reconstructed from usage-JSONL per-response timestamps for the CLI
 * harnesses (claude-cli / codex-cli / terminal usage). The builtin harness does
 * NOT use this path — its message timestamps are write-time, so builtin runtime
 * is captured live as work intervals instead (interval-tracker.ts).
 */
import { localDateKey } from '../date-keys';

export interface Session {
  /** ms since epoch */
  start: number;
  /** ms since epoch */
  end: number;
}

/**
 * Gap-only sessionization for a bare list of activity timestamps (no roles).
 *
 * Used for runtime derived from usage JSONLs, where the sample points are the
 * provider's per-response records (all "agent side") — there is no reliable
 * user/assistant split to key off. A new session starts whenever the gap since
 * the previous activity exceeds `idleGapMs` (the human stepped away). Within a
 * session, sub-threshold gaps (reading/thinking between turns) are kept as
 * billable engagement time. Sorted ascending first (non-monotonic-clock safe).
 */
export function sessionizeTimestamps(timestamps: number[], idleGapMs = 5 * 60_000): Session[] {
  const ts = timestamps.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (ts.length === 0) return [];
  const out: Session[] = [];
  let start = ts[0];
  let prev = ts[0];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - prev > idleGapMs) {
      out.push({ start, end: prev });
      start = ts[i];
    }
    prev = ts[i];
  }
  out.push({ start, end: prev });
  return out;
}

export interface DaySlice {
  dateKey: string;
  ms: number;
}

/**
 * Split a `[start, end]` ms span into per-local-day slices, breaking at local
 * midnight so an overnight session is attributed to the correct calendar days.
 * Zero/negative spans yield an empty array (no billable time).
 */
export function splitByDay(start: number, end: number): DaySlice[] {
  if (end <= start) return [];
  const out: DaySlice[] = [];
  let cur = start;
  while (cur < end) {
    const d = new Date(cur);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
    const sliceEnd = Math.min(end, nextMidnight);
    out.push({ dateKey: localDateKey(cur), ms: sliceEnd - cur });
    cur = sliceEnd;
  }
  return out;
}
