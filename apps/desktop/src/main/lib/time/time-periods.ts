/**
 * Pure calendar-period math for the Time/billing page. No DB, no Electron.
 *
 * All boundaries are LOCAL-timezone (invoicing is by local calendar day/month).
 * `endMs` is an exclusive upper bound; `startKey`/`endKey` are inclusive
 * `YYYY-MM-DD` bounds for filtering the day-bucketed `token_daily` table.
 */
import { localDateKey, mondayDayOfWeek } from '../date-keys';

export type TimePeriod = 'today' | 'week' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'all';

export interface PeriodRange {
  startMs: number;
  endMs: number; // exclusive
  startKey: string;
  endKey: string; // inclusive (last day touched by the range)
}

export function periodRange(period: TimePeriod, now: number): PeriodRange {
  const d = new Date(now);
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  let startMs: number;
  let endMs = now;

  switch (period) {
    case 'today':
      startMs = startOfToday;
      break;
    case 'week':
      // Calendar arithmetic (not ms subtraction) so a DST transition within the
      // week can't shift the Monday boundary off by an hour / wrong day.
      startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayDayOfWeek(now)).getTime();
      break;
    case '7d':
      // Calendar-day window (last 7 local days incl. today), so the day-bucketed
      // token_daily filter (>= startKey) and the runtime clip (>= startMs) share
      // the SAME boundary — a mid-day startMs would let the boundary day's full
      // cost in while clipping its runtime, over-stating spend.
      startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
      break;
    case '30d':
      startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29).getTime();
      break;
    case 'thisMonth':
      startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      break;
    case 'lastMonth':
      startMs = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
      endMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      break;
    case 'all':
    default:
      startMs = 0;
      break;
  }

  return {
    startMs,
    endMs,
    startKey: localDateKey(startMs),
    // endMs is exclusive, so the last touched calendar day is endMs - 1.
    endKey: localDateKey(Math.max(startMs, endMs - 1))
  };
}
