import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageEntry } from './types';
import { walkJsonlFiles } from './jsonl-walk';

// Codex rollout transcripts are named `rollout-*.jsonl`.
const acceptCodex = (name: string) => name.startsWith('rollout-') && name.endsWith('.jsonl');

function codexSessionsRoot(): string {
  // Codex CLI does not advertise a CODEX_CONFIG_DIR override today; hardcode
  // the default but keep it centralized so a future override is a one-liner.
  return join(homedir(), '.codex', 'sessions');
}

type CodexRecord = {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: string;
    id?: string; // session_meta: the session id
    cwd?: string; // session_meta: the working directory
    info?: {
      last_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };
  };
};

function parseLine(line: string): CodexRecord | null {
  if (!line || line[0] !== '{') return null;
  try {
    return JSON.parse(line) as CodexRecord;
  } catch {
    return null;
  }
}

/**
 * Scan one Codex session file.
 *
 * Codex CLI writes a `session_meta` line at the top, then `turn_context`
 * (which carries the model), then an `event_msg` of payload-type `token_count`
 * after each model response. The token_count payload carries
 * `info.last_token_usage` — interpreted here as the usage for the response
 * that just finished, so summing across events gives the session total.
 *
 * `input_tokens` in Codex INCLUDES cached tokens (unlike Anthropic), so we
 * subtract `cached_input_tokens` to land on a comparable "true new input"
 * bucket. The cached portion goes into `cacheReadTokens`.
 */
async function readSession(file: string, sinceMs: number | null): Promise<UsageEntry[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  let currentModel: string | null = null;
  let sessionId: string | null = null;
  let cwd: string | null = null;
  const out: UsageEntry[] = [];
  let tokenEventIndex = 0;

  for (const line of raw.split('\n')) {
    const rec = parseLine(line);
    if (!rec) continue;

    if (rec.type === 'session_meta' && rec.payload?.id && !sessionId) {
      sessionId = rec.payload.id;
    }
    if (rec.type === 'session_meta' && rec.payload?.cwd && !cwd) {
      cwd = rec.payload.cwd;
    }
    if (rec.type === 'turn_context' && rec.payload?.model) {
      currentModel = rec.payload.model;
      continue;
    }
    if (rec.type === 'session_meta' && rec.payload?.model && !currentModel) {
      currentModel = rec.payload.model;
      continue;
    }

    if (rec.type !== 'event_msg' || rec.payload?.type !== 'token_count') continue;
    const usage = rec.payload?.info?.last_token_usage;
    if (!usage) continue;

    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isFinite(ts)) continue;
    if (sinceMs !== null && ts < sinceMs) continue;

    const inputWithCached = usage.input_tokens ?? 0;
    const cached = usage.cached_input_tokens ?? 0;
    const inputUncached = Math.max(0, inputWithCached - cached);
    const output = usage.output_tokens ?? 0;
    if (inputUncached === 0 && output === 0 && cached === 0) continue;

    out.push({
      ts,
      model: currentModel ?? 'gpt-unknown',
      source: 'codex',
      inputTokens: inputUncached,
      outputTokens: output,
      cacheCreationTokens: 0,
      cacheReadTokens: cached,
      dedupKey: `${file}:${tokenEventIndex}`,
      costUSD: null,
      sessionId,
      cwd
    });
    tokenEventIndex += 1;
  }
  return out;
}

/** List the Codex rollout JSONL paths without parsing them (cheap fingerprint). */
export async function listCodexUsageFiles(): Promise<string[]> {
  const files: string[] = [];
  await walkJsonlFiles(codexSessionsRoot(), files, acceptCodex);
  return files;
}

export async function readCodexUsage(sinceMs: number | null = null, prelistedFiles?: string[]): Promise<UsageEntry[]> {
  // Reuse an already-walked file list when the caller provides one.
  let files: string[];
  if (prelistedFiles) {
    files = prelistedFiles;
  } else {
    files = [];
    await walkJsonlFiles(codexSessionsRoot(), files, acceptCodex);
  }

  const results = await Promise.all(
    files.map(async (file) => {
      if (sinceMs !== null) {
        try {
          const st = await stat(file);
          if (st.mtimeMs < sinceMs) return [];
        } catch {
          return [];
        }
      }
      return readSession(file, sinceMs);
    })
  );
  return results.flat();
}
