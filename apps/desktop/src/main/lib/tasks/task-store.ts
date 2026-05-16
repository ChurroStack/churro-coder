import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteArtifact } from '../sub-chat-artifacts/atomic-write';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanTask {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface TaskListMeta {
  source: string;
  updatedAt: string;
}

export interface TaskListData {
  tasks: PlanTask[];
  meta: TaskListMeta;
}

const tasksWrittenEmitter = new EventEmitter();

export function onTasksWritten(handler: (event: { subChatId: string; filePath: string }) => void): () => void {
  tasksWrittenEmitter.on('tasks-written', handler);
  return () => tasksWrittenEmitter.off('tasks-written', handler);
}

function getTasksDir(subChatId: string): string {
  return join(app.getPath('userData'), 'sub-chats', subChatId, 'tasks');
}

function getTasksFilePath(subChatId: string): string {
  return join(getTasksDir(subChatId), 'current.json');
}

// Per-subChatId serial write queue to prevent interleaved read-modify-writes.
const writeQueues = new Map<string, Promise<void>>();

function enqueue(subChatId: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(subChatId) ?? Promise.resolve();
  const next = prev.then(fn).catch(fn);
  writeQueues.set(subChatId, next);
  return next;
}

async function persistTasks(subChatId: string, data: TaskListData): Promise<void> {
  const filePath = getTasksFilePath(subChatId);
  await atomicWriteArtifact(filePath, JSON.stringify(data, null, 2));
  console.log(`[churro-coder] tasks persisted sub=${subChatId} source=${data.meta.source} count=${data.tasks.length}`);
  tasksWrittenEmitter.emit('tasks-written', { subChatId, filePath });
}

export async function writeTasks(opts: { subChatId: string; tasks: PlanTask[]; source: string }): Promise<void> {
  return enqueue(opts.subChatId, async () => {
    const data: TaskListData = {
      tasks: opts.tasks,
      meta: { source: opts.source, updatedAt: new Date().toISOString() }
    };
    await persistTasks(opts.subChatId, data);
  });
}

export type UpdateTaskStatusResult = { ok: true } | { ok: false; reason: 'unknown-id' | 'no-list' };

export async function updateTaskStatus(opts: {
  subChatId: string;
  id: string;
  status: TaskStatus;
  source: string;
}): Promise<UpdateTaskStatusResult> {
  let result: UpdateTaskStatusResult = { ok: true };

  await enqueue(opts.subChatId, async () => {
    let current: TaskListData;
    try {
      const raw = await readFile(getTasksFilePath(opts.subChatId), 'utf8');
      current = JSON.parse(raw) as TaskListData;
    } catch {
      result = { ok: false, reason: 'no-list' };
      return;
    }

    const idx = current.tasks.findIndex((t) => t.id === opts.id);
    if (idx === -1) {
      result = { ok: false, reason: 'unknown-id' };
      return;
    }

    current.tasks[idx] = { ...current.tasks[idx]!, status: opts.status };
    current.meta = { source: opts.source, updatedAt: new Date().toISOString() };

    await persistTasks(opts.subChatId, current);
    console.log(`[churro-coder] task-status updated sub=${opts.subChatId} id=${opts.id} status=${opts.status}`);
  });

  return result;
}

export async function readTasks(subChatId: string): Promise<TaskListData | null> {
  try {
    const raw = await readFile(getTasksFilePath(subChatId), 'utf8');
    return JSON.parse(raw) as TaskListData;
  } catch {
    return null;
  }
}
