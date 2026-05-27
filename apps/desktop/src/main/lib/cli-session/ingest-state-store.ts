/**
 * Per-sub-chat ingest checkpoint for the CLI session ingester.
 *
 * Persisted at:
 *   <userData>/sub-chats/<subChatId>/cli-ingest.json
 *
 * Mirrors the file-backed pattern used by plan-store / file-changes-store /
 * task-store so it lives alongside the other sub-chat artifacts and rides
 * the same atomic-write helper.
 */

import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteArtifact } from '../sub-chat-artifacts/atomic-write';

const TRACE = '[cli-ingest-state]';

export interface IngestState {
  /** Absolute path to the session file we're currently tracking. */
  sessionFile: string;
  /** Byte offset in `sessionFile` of the next unread byte. */
  byteOffset: number;
  /** UUIDs of messages we've already persisted — used for dedup. Bounded set
   *  (we keep the most recent N to defeat infinite growth). */
  messageUuids: string[];
  /** Next `messages.idx` to assign. Continues monotonically across CLI
   *  restarts even when `sessionFile` changes (continuous-transcript model). */
  nextIdx: number;
}

const MAX_UUID_HISTORY = 1000;

function dir(subChatId: string): string {
  return join(app.getPath('userData'), 'sub-chats', subChatId);
}

function file(subChatId: string): string {
  return join(dir(subChatId), 'cli-ingest.json');
}

export async function readIngestState(subChatId: string): Promise<IngestState | null> {
  try {
    const raw = await readFile(file(subChatId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<IngestState>;
    if (
      typeof parsed.sessionFile === 'string' &&
      typeof parsed.byteOffset === 'number' &&
      typeof parsed.nextIdx === 'number' &&
      Array.isArray(parsed.messageUuids)
    ) {
      return {
        sessionFile: parsed.sessionFile,
        byteOffset: parsed.byteOffset,
        messageUuids: parsed.messageUuids.filter((u): u is string => typeof u === 'string'),
        nextIdx: parsed.nextIdx
      };
    }
    console.warn(`${TRACE} malformed sub=${subChatId} — treating as missing`);
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') console.warn(`${TRACE} read failed sub=${subChatId} code=${code}`);
    return null;
  }
}

export async function writeIngestState(subChatId: string, state: IngestState): Promise<void> {
  const trimmed: IngestState = {
    ...state,
    messageUuids: state.messageUuids.slice(-MAX_UUID_HISTORY)
  };
  await atomicWriteArtifact(file(subChatId), JSON.stringify(trimmed, null, 2));
}

export interface MutateInput {
  /** Empty state (used when `read` returned null). Caller may still mutate. */
  empty: () => IngestState;
}

/**
 * Read-modify-write helper. The mutator runs on a fresh copy; the result is
 * persisted atomically. Concurrent calls for the same subChatId must be
 * coordinated by the caller's per-subchat lock — this helper is not itself
 * lock-safe across rapid writers.
 */
export async function mutateIngestState(
  subChatId: string,
  mutator: (state: IngestState) => IngestState | Promise<IngestState>,
  empty: () => IngestState
): Promise<IngestState> {
  const current = (await readIngestState(subChatId)) ?? empty();
  const next = await mutator({ ...current, messageUuids: [...current.messageUuids] });
  await writeIngestState(subChatId, next);
  return next;
}

export function emptyIngestState(sessionFile: string, nextIdx = 0): IngestState {
  return { sessionFile, byteOffset: 0, messageUuids: [], nextIdx };
}
