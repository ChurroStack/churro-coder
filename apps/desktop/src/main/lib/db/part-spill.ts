import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export const SPILL_THRESHOLD = 256 * 1024; // 256 KB

export function spillDir(subChatId: string): string {
  return path.join(app.getPath('userData'), 'agent-sessions', subChatId, 'parts');
}

export function spillFileName(messageId: string, partIdx: number): string {
  return `${messageId}-${partIdx}.bin`;
}

export function spillPath(subChatId: string, messageId: string, partIdx: number): string {
  return path.join(spillDir(subChatId), spillFileName(messageId, partIdx));
}

/**
 * If the JSON-serialized part exceeds SPILL_THRESHOLD, write it to disk and
 * return a small _spill envelope in its place. Otherwise return the part unchanged.
 *
 * Used synchronously inside better-sqlite3 transactions and the backfill loop.
 * Caller should wrap in try/catch and fall back to the original part on error.
 */
export function writePartIfLargeSync(subChatId: string, messageId: string, partIdx: number, part: unknown): unknown {
  const json = JSON.stringify(part);
  const byteLen = Buffer.byteLength(json, 'utf8');
  if (byteLen < SPILL_THRESHOLD) return part;

  const dir = spillDir(subChatId);
  const file = spillFileName(messageId, partIdx);
  const fullPath = path.join(dir, file);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, json, 'utf8');

  // Preserve `state` in the stub. It's a tiny scalar, and the CLI-ingest
  // tool-result repair gate (`hasOrphanedToolPart`) detects an orphaned tool
  // call by scanning row JSON for `"state":"input-available"`. Without this, a
  // spilled tool_use part (>256 KB input) whose result was dropped is invisible
  // to the gate, so the repair walk never runs and it renders "interrupted"
  // forever. `toolCallId` is intentionally NOT carried — that keeps spilled
  // parts out of the by-toolCallId patch path (which would half-merge the stub);
  // the repair walk rebuilds and re-spills them whole.
  const state = (part as { state?: unknown }).state;
  return {
    type: (part as { type?: string }).type ?? 'unknown',
    ...(typeof state === 'string' ? { state } : {}),
    _spill: {
      ref: `${subChatId}/parts/${file}`,
      bytes: byteLen,
      encoding: 'utf8-json' as const,
      preview: json.slice(0, 4096)
    }
  };
}
