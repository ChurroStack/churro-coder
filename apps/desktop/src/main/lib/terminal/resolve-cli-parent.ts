import { eq } from 'drizzle-orm';
import { getDatabase, subChats } from '../db';

// subChatId → parentChatId is immutable once a sub-chat row exists, so successful
// lookups are cached for the process lifetime. Null results are NOT cached so a
// lookup that races sub-chat creation can succeed on a later event.
const parentCache = new Map<string, string>();

/**
 * Resolve the parent chat id for a CLI sub-chat's busy/state event.
 *
 * Prefers the value the PTY session recorded (the renderer's `workspaceId`).
 * When that's empty — e.g. a restored or remote-controlled session where the
 * renderer never threaded a `chatId` into the terminal session — it falls back
 * to the authoritative `subChats.chatId` in the DB.
 *
 * Without this, parent-keyed busy consumers (the sidebar workspace-row spinner,
 * project-group header, kanban card) silently skip the sub-chat because they
 * only aggregate entries with a truthy `parentChatId`, so the CLI looks idle in
 * the chrome even while it's working (the tab icon, keyed by subChatId, still
 * spins). See `terminal/manager.ts` (`parentChatId: session.workspaceId || null`).
 */
export function resolveCliParentChatId(subChatId: string, sessionParentChatId: string | null): string | null {
  if (sessionParentChatId) return sessionParentChatId;

  const cached = parentCache.get(subChatId);
  if (cached !== undefined) return cached;

  try {
    const row = getDatabase()
      .select({ chatId: subChats.chatId })
      .from(subChats)
      .where(eq(subChats.id, subChatId))
      .get();
    const parent = row?.chatId ?? null;
    if (parent) parentCache.set(subChatId, parent);
    return parent;
  } catch (err) {
    console.warn(`[cli-parent-resolve] lookup failed sub=${subChatId}:`, err);
    return null;
  }
}

/** Clear the resolver cache (testing only). */
export function clearCliParentCache(): void {
  parentCache.clear();
}
