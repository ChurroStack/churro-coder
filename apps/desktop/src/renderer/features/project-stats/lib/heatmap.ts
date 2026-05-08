export type HeatmapCellInput = {
  date: string;
  dayOfWeek: number;
  weekIndex: number;
  commits: number;
};

/**
 * Trim leading empty weeks so a sparse repo (e.g. only the last 30 days have
 * commits) doesn't render an almost-empty 365-day grid that has to scroll.
 * Keeps one week of padding before the first commit; re-indexes weekIndex.
 */
export function trimEmptyLeadingWeeks<T extends HeatmapCellInput>(cells: T[]): T[] {
  const firstActiveWeek = cells.reduce((min, c) => (c.commits > 0 ? Math.min(min, c.weekIndex) : min), Infinity);
  const startWeek = firstActiveWeek === Infinity ? 0 : Math.max(0, firstActiveWeek - 1);
  if (startWeek === 0) return cells;
  return cells.filter((c) => c.weekIndex >= startWeek).map((c) => ({ ...c, weekIndex: c.weekIndex - startWeek }));
}
