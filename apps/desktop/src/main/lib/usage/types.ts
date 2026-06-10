/**
 * Normalized usage entry produced by each reader.
 * All token fields are absolute counts (not deltas). `source` tells the
 * aggregator which provider the entry came from so the UI can filter by it.
 */
export type UsageSource = 'claude' | 'codex';

export type UsageEntry = {
  /** Wall-clock timestamp of the record (ms since epoch). */
  ts: number;
  /** Raw model id from the provider (e.g., "claude-opus-4-6", "gpt-5-codex"). */
  model: string;
  source: UsageSource;
  inputTokens: number;
  outputTokens: number;
  /** Cache-creation tokens (Anthropic only; 0 for Codex). */
  cacheCreationTokens: number;
  /** Cache-read tokens (both providers). */
  cacheReadTokens: number;
  /** Stable id used for dedup: `${messageId}:${requestId}`. Claude-only in practice. */
  dedupKey: string | null;
  /**
   * Cost pre-computed by the provider, when available.
   * Anthropic Claude Code writes this on some assistant messages. Prefer it
   * when present so totals line up with Anthropic's own billing numbers.
   */
  costUSD: number | null;
  /**
   * CLI session id this entry belongs to — Claude: the JSONL filename stem;
   * Codex: `session_meta.payload.id`. Used by the time/billing rollup to
   * attribute spend to a sub-chat (via subChats.cliSessionId / sessionId).
   * Optional: the Usage dashboard ignores it.
   */
  sessionId?: string | null;
  /**
   * Working directory the session ran in — Claude: the `cwd` field on its
   * records; Codex: `session_meta.payload.cwd`. The time/billing rollup maps
   * this to a project (see time/project-resolver.ts) so terminal usage attributes
   * to the right project, not an "unattributed" bucket. Optional.
   */
  cwd?: string | null;
};

export type UsagePeriod = '7d' | '30d' | '90d' | 'all';
export type UsageSourceFilter = UsageSource | 'all';
