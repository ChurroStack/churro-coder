import { eq } from 'drizzle-orm';
import { subChats } from './db/schema';

export type PersistedRunMode = 'plan' | 'execute' | 'explore';

export function normalizePersistedRunMode(mode: string | null | undefined): PersistedRunMode {
  if (mode === 'plan' || mode === 'execute' || mode === 'explore') return mode;
  if (mode === 'agent') return 'execute';
  return 'plan';
}

// Treat only the canonical plan-store paths as plan files. Project files like
// `release-plan.md` or `migration-plan.md` belong to the user, not the
// plan-store, so an agent edit there should still count as agent activity.
//   • Current store: `<userData>/sub-chats/<id>/plans/current.md(.meta.json)`
//   • Legacy store : `…/claude-sessions/.../plans/...`
function isPlanFile(filePath: string): boolean {
  return (
    /\/sub-chats\/[^/]+\/plans\//.test(filePath) || /(?:claude-sessions|agent-sessions)\/.*\/plans\//.test(filePath)
  );
}

// Tool-part types that signify a real file write. Mirrors the allowlist used
// in claude.ts (`new Set(['Edit','Write','NotebookEdit','MultiEdit'])`).
const WRITE_TOOL_TYPES = new Set(['tool-Edit', 'tool-Write', 'tool-MultiEdit', 'tool-NotebookEdit']);

function hasNonPlanFileEdit(messagesJson: string | null | undefined): boolean {
  if (!messagesJson) return false;

  try {
    const messages = JSON.parse(messagesJson);
    if (!Array.isArray(messages)) return false;

    return messages.some((message: any) => {
      if (message?.role !== 'assistant' || !Array.isArray(message.parts)) return false;

      return message.parts.some((part: any) => {
        if (!WRITE_TOOL_TYPES.has(part?.type)) {
          return false;
        }

        const filePath = part?.input?.file_path || part?.input?.path || '';
        return typeof filePath === 'string' && filePath.length > 0 && !isPlanFile(filePath);
      });
    });
  } catch {
    return false;
  }
}

export function inferSubChatModeForHydration(row: {
  mode: string | null | undefined;
  sessionMode?: string | null;
  messages?: string | null;
}): PersistedRunMode {
  const mode = normalizePersistedRunMode(row.mode);
  const sessionMode = normalizePersistedRunMode(row.sessionMode);

  if (mode === 'plan' && (sessionMode === 'execute' || hasNonPlanFileEdit(row.messages))) {
    return 'execute';
  }

  return mode;
}

/**
 * Keep the persisted sub-chat mode aligned with the mode actually used to
 * start a stream. Renderer mode atoms can be fresher than the DB during
 * startup/new-chat races; restart hydration reads the DB.
 */
export function persistSubChatRunMode(params: {
  db: { update: (table: typeof subChats) => any };
  subChatId: string;
  // `null`/`undefined` means caller didn't find the row (yet) — skip the write.
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
  T extends { id: string; mode: string | null; sessionMode?: string | null; messages?: string | null }
>(db: { update: (table: typeof subChats) => any }, row: T): T & { mode: PersistedRunMode } {
  const effectiveMode = inferSubChatModeForHydration(row);
  if (effectiveMode === normalizePersistedRunMode(row.mode)) {
    return row as T & { mode: PersistedRunMode };
  }

  db.update(subChats).set({ mode: effectiveMode }).where(eq(subChats.id, row.id)).run();
  return { ...row, mode: effectiveMode };
}
