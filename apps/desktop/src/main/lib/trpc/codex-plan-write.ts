const PROTOCOL_SHAPED_SUMMARY_PREFIX = /^(?:PlanWrite\s+action=|Tool:\s*\w+(?:\s+action=|$))/i;

export function sanitizeCodexPlanSummary(summary?: string | null): string {
  const trimmed = summary?.trim() ?? '';
  if (!trimmed) return '';
  if (!PROTOCOL_SHAPED_SUMMARY_PREFIX.test(trimmed)) {
    return trimmed;
  }

  console.warn('[codex] Dropping protocol-shaped plan summary text before persistence');
  return '';
}
