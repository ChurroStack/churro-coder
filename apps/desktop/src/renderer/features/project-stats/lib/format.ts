export { formatCompact, formatFull, formatShortDate } from '../../usage/lib/format';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * Natural-language relative date ("today", "in 3 days", "2 weeks ago") from an
 * ISO date string. Distinct from the changes feature's compact "5m ago" formatter
 * (`formatRelativeDateCompact`).
 */
export function formatRelativeDateNatural(isoDate: string): string {
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

export function formatShortHash(hash: string): string {
  return hash.slice(0, 7);
}
