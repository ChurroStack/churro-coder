import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { atomicWriteArtifact } from '../sub-chat-artifacts/atomic-write';

export type FileChangeAction = 'create' | 'update' | 'delete';

export interface FileChangeEntry {
  path: string;
  action: FileChangeAction;
  reportedAt: string;
  source: string;
}

export interface FileChangesData {
  entries: FileChangeEntry[];
}

const fileChangesEmitter = new EventEmitter();
fileChangesEmitter.setMaxListeners(50);

export interface FileChangesNotifiedEvent {
  subChatId: string;
}

export function onFileChangesNotified(handler: (event: FileChangesNotifiedEvent) => void): () => void {
  fileChangesEmitter.on('notified', handler);
  return () => fileChangesEmitter.off('notified', handler);
}

function getFileChangesDir(subChatId: string): string {
  return join(app.getPath('userData'), 'sub-chats', subChatId, 'file-changes');
}

function getFileChangesFilePath(subChatId: string): string {
  return join(getFileChangesDir(subChatId), 'current.json');
}

// Per-subChatId serial write queue to prevent interleaved read-modify-writes.
const writeQueues = new Map<string, Promise<void>>();

function enqueue(subChatId: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(subChatId) ?? Promise.resolve();
  const next = prev.then(fn).catch(fn);
  writeQueues.set(subChatId, next);
  return next;
}

export async function notifyFilesChanged(opts: {
  subChatId: string;
  files: Array<{ path: string; action: FileChangeAction }>;
  source: string;
}): Promise<void> {
  return enqueue(opts.subChatId, async () => {
    let existing: FileChangesData = { entries: [] };
    try {
      const raw = await readFile(getFileChangesFilePath(opts.subChatId), 'utf8');
      existing = JSON.parse(raw) as FileChangesData;
    } catch {
      // No existing file — start fresh
    }

    // Dedup by path: last write wins on action
    const byPath = new Map<string, FileChangeEntry>(existing.entries.map((e) => [e.path, e]));
    const now = new Date().toISOString();
    for (const file of opts.files) {
      byPath.set(file.path, { path: file.path, action: file.action, reportedAt: now, source: opts.source });
    }

    const data: FileChangesData = { entries: Array.from(byPath.values()) };
    const filePath = getFileChangesFilePath(opts.subChatId);
    await atomicWriteArtifact(filePath, JSON.stringify(data, null, 2));
    console.log(
      `[churro-coder] file-changes notified sub=${opts.subChatId} count=${opts.files.length} total=${data.entries.length} source=${opts.source}`
    );
    fileChangesEmitter.emit('notified', { subChatId: opts.subChatId });
  });
}

export async function readFileChanges(subChatId: string): Promise<FileChangesData | null> {
  try {
    const raw = await readFile(getFileChangesFilePath(subChatId), 'utf8');
    return JSON.parse(raw) as FileChangesData;
  } catch {
    return null;
  }
}
