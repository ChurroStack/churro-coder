/** "3h 42m" / "42m" / "0m" — billable runtime from a millisecond duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin === 0) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/** "Mar 19, 12:43" — a compact local date+time hint for when a session started. */
export function formatTimestamp(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
