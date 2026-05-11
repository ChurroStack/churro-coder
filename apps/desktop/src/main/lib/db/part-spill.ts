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

  return {
    type: (part as { type?: string }).type ?? 'unknown',
    _spill: {
      ref: `${subChatId}/parts/${file}`,
      bytes: byteLen,
      encoding: 'utf8-json' as const,
      preview: json.slice(0, 4096)
    }
  };
}
