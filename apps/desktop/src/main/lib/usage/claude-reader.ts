import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageEntry } from './types';
import { walkJsonlFiles } from './jsonl-walk';

const acceptClaude = (name: string) => name.endsWith('.jsonl');

/**
 * Root directory Claude Code writes session JSONLs to.
 * Honors CLAUDE_CONFIG_DIR (may be colon-separated for multi-root installs),
 * matching ccusage's resolution order.
 */
function claudeProjectRoots(): string[] {
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir && envDir.trim().length > 0) {
    return envDir
      .split(':')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => join(d, 'projects'));
  }
  return [join(homedir(), '.claude', 'projects')];
}

type ClaudeRecord = {
  type?: string;
  timestamp?: string;
  requestId?: string;
  cwd?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  costUSD?: number;
};

function parseLine(line: string): ClaudeRecord | null {
  if (!line || line[0] !== '{') return null;
  try {
    return JSON.parse(line) as ClaudeRecord;
  } catch {
    return null;
  }
}

function toEntry(rec: ClaudeRecord, sessionId: string | null, cwd: string | null): UsageEntry | null {
  if (rec.type !== 'assistant') return null;
  const u = rec.message?.usage;
  if (!u) return null;
  const model = rec.message?.model;
  if (!model) return null;
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  if (!Number.isFinite(ts)) return null;
  const messageId = rec.message?.id ?? '';
  const requestId = rec.requestId ?? '';
  const dedupKey = messageId && requestId ? `${messageId}:${requestId}` : null;
  return {
    ts,
    model,
    source: 'claude',
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    dedupKey,
    costUSD: typeof rec.costUSD === 'number' ? rec.costUSD : null,
    sessionId,
    cwd
  };
}

/**
 * Read all Claude Code session JSONLs and return normalized entries.
 * Files newer than `sinceMs` are fully scanned; older ones are skipped by
 * mtime to keep the scan cheap even across many months of transcripts.
 */
export async function readClaudeUsage(sinceMs: number | null = null, prelistedFiles?: string[]): Promise<UsageEntry[]> {
  // Callers that already walked the tree (e.g. the rollup's freshness scan) pass
  // the file list to avoid a second recursive traversal.
  let files: string[];
  if (prelistedFiles) {
    files = prelistedFiles;
  } else {
    files = [];
    for (const root of claudeProjectRoots()) {
      await walkJsonlFiles(root, files, acceptClaude);
    }
  }

  const entries: UsageEntry[] = [];
  await Promise.all(
    files.map(async (file) => {
      if (sinceMs !== null) {
        try {
          const st = await stat(file);
          if (st.mtimeMs < sinceMs) return;
        } catch {
          return;
        }
      }
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        return;
      }
      // Claude writes one JSONL per session named `<session-id>.jsonl`; the
      // stem is the session id we match against subChats.cliSessionId/sessionId.
      const base = file.slice(file.lastIndexOf('/') + 1);
      const sessionId = base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : null;
      // cwd is stamped on the session's records (constant per session); carry the
      // last-seen value forward so every entry is attributed to its project.
      let cwd: string | null = null;
      for (const line of raw.split('\n')) {
        const rec = parseLine(line);
        if (!rec) continue;
        if (rec.cwd) cwd = rec.cwd;
        const entry = toEntry(rec, sessionId, cwd);
        if (!entry) continue;
        if (sinceMs !== null && entry.ts < sinceMs) continue;
        entries.push(entry);
      }
    })
  );
  return entries;
}

/** List the Claude session JSONL paths without parsing them (cheap fingerprint). */
export async function listClaudeUsageFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of claudeProjectRoots()) {
    await walkJsonlFiles(root, files, acceptClaude);
  }
  return files;
}
