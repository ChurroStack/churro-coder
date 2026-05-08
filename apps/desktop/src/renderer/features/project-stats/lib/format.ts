export { formatCompact, formatFull } from '../../usage/lib/format';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86400000);
  if (Math.abs(diffDays) < 1) return 'today';
  if (Math.abs(diffDays) < 7) return rtf.format(diffDays, 'day');
  if (Math.abs(diffDays) < 31) return rtf.format(Math.round(diffDays / 7), 'week');
  if (Math.abs(diffDays) < 365) return rtf.format(Math.round(diffDays / 30), 'month');
  return rtf.format(Math.round(diffDays / 365), 'year');
}

export function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatShortHash(hash: string): string {
  return hash.slice(0, 7);
}
