/** `YYYY-MM-DD` in the LOCAL timezone — the canonical calendar-day bucket key
 * shared by usage aggregation and time/billing rollups. */
export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday-indexed day of week (0=Mon .. 6=Sun) — the shared week-start convention
 * for the usage heatmap and the Time page's week period. */
export function mondayDayOfWeek(ts: number): number {
  return (new Date(ts).getDay() + 6) % 7;
}
