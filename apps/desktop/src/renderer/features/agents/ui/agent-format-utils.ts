export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `<$0.01`;
  }
  if (usd < 1) {
    return `$${usd.toFixed(3)}`;
  }
  return `$${usd.toFixed(2)}`;
}

/** Aggregate per-tool counts a subagent run reports in `toolUseResult.toolStats`. */
export interface SubagentToolStats {
  readCount?: number;
  searchCount?: number;
  bashCount?: number;
  editFileCount?: number;
  linesAdded?: number;
  linesRemoved?: number;
  otherToolCount?: number;
}

/**
 * Build a compact, human activity summary from a subagent's `toolStats`, e.g.
 * `18 reads · 13 commands · 2 edits (+40 -5)`. Only non-zero counts appear;
 * returns `''` when the subagent did no tracked work (so the caller can hide
 * the line). Mirrors the native CLI's per-subagent activity line.
 */
export function summarizeToolStats(stats: SubagentToolStats | null | undefined): string {
  if (!stats || typeof stats !== 'object') return '';
  const seg: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const reads = stats.readCount ?? 0;
  if (reads > 0) seg.push(plural(reads, 'read', 'reads'));

  const searches = stats.searchCount ?? 0;
  if (searches > 0) seg.push(plural(searches, 'search', 'searches'));

  const commands = stats.bashCount ?? 0;
  if (commands > 0) seg.push(plural(commands, 'command', 'commands'));

  const edits = stats.editFileCount ?? 0;
  if (edits > 0) {
    const added = stats.linesAdded ?? 0;
    const removed = stats.linesRemoved ?? 0;
    const diff = added > 0 || removed > 0 ? ` (+${added} -${removed})` : '';
    seg.push(`${plural(edits, 'edit', 'edits')}${diff}`);
  }

  const other = stats.otherToolCount ?? 0;
  if (other > 0) seg.push(`${other} other`);

  return seg.join(' · ');
}

export function isNormalStop(stopReason: string): boolean {
  return stopReason === 'end_turn' || stopReason === 'stop';
}

export function humanizeStopReason(stopReason: string): string {
  switch (stopReason) {
    case 'max_tokens':
    case 'length':
      return 'hit max tokens';
    case 'tool_calls':
      return 'stopped at tool boundary';
    case 'content_filter':
      return 'content filtered';
    case 'error':
      return 'error';
    default:
      return stopReason;
  }
}
