import { eq } from 'drizzle-orm';
import { subChats } from './db/schema';

export type PersistedRunMode = 'plan' | 'execute' | 'explore';

export function normalizePersistedRunMode(mode: string | null | undefined): PersistedRunMode {
  if (mode === 'plan' || mode === 'execute' || mode === 'explore') return mode;
  if (mode === 'agent') return 'execute';
  return 'plan';
}

// Treat only the canonical plan-store paths as plan files.
function isPlanFile(filePath: string): boolean {
  return (
    /\/sub-chats\/[^/]+\/plans\//.test(filePath) || /(?:claude-sessions|agent-sessions)\/.*\/plans\//.test(filePath)
  );
}

const WRITE_TOOL_TYPES = new Set(['tool-Edit', 'tool-Write', 'tool-MultiEdit', 'tool-NotebookEdit']);

function hasNonPlanFileEdit(msgs: any[] | string | null | undefined): boolean {
  let messages: any[];
  if (Array.isArray(msgs)) {
    messages = msgs;
  } else if (typeof msgs === 'string') {
    if (!msgs) return false;
    try { messages = JSON.parse(msgs); } catch { return false; }
    if (!Array.isArray(messages)) return false;
  } else {
    return false;
  }

  return messages.some((message: any) => {
    if (message?.role !== 'assistant' || !Array.isArray(message.parts)) return false;
    return message.parts.some((part: any) => {
      if (!WRITE_TOOL_TYPES.has(part?.type)) return false;
      const filePath = part?.input?.file_path || part?.input?.path || '';
      return typeof filePath === 'string' && filePath.length > 0 && !isPlanFile(filePath);
    });
  });
}

export function inferSubChatModeForHydration(row: {
  mode: string | null | undefined;
  sessionMode?: string | null;
  messages?: any[] | string | null;
}): PersistedRunMode {
  const mode = normalizePersistedRunMode(row.mode);
  const sessionMode = normalizePersistedRunMode(row.sessionMode);

  if (mode === 'plan' && (sessionMode === 'execute' || hasNonPlanFileEdit(row.messages))) {
    return 'execute';
  }

  return mode;
}

export function persistSubChatRunMode(params: {
  db: { update: (table: typeof subChats) => any };
  subChatId: string;
  existingMode: string | null | undefined;
  inputMode: PersistedRunMode;
}): boolean {
  if (params.existingMode == null || normalizePersistedRunMode(params.existingMode) === params.inputMode) {
    return false;
  }

  params.db.update(subChats).set({ mode: params.inputMode }).where(eq(subChats.id, params.subChatId)).run();
  return true;
}

export function repairSubChatModeForHydration<
  T extends { id: string; mode: string | null; sessionMode?: string | null; messages?: any[] | string | null }
>(db: { update: (table: typeof subChats) => any }, row: T): T & { mode: PersistedRunMode } {
  const effectiveMode = inferSubChatModeForHydration(row);
  if (effectiveMode === normalizePersistedRunMode(row.mode)) {
    return row as T & { mode: PersistedRunMode };
  }

  db.update(subChats).set({ mode: effectiveMode }).where(eq(subChats.id, row.id)).run();
  return { ...row, mode: effectiveMode };
}
