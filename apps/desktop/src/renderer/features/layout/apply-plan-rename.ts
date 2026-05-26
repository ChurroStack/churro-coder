/**
 * Applies the rename portion of an `artifactWritten` event to the renderer's
 * jotai store + tRPC caches. Extracted from the `details-rail` subscription
 * handler so the logic is pure and unit-testable without mounting the full
 * component (which pulls in dockview, ~15 atom families, and tRPC).
 *
 * The DB write already happened server-side in `renameSubChatOnFirstPlan` —
 * this hook is a real-time optimization so the dockview tab title and the
 * sidebar update without waiting for a chat-switch refetch.
 */

export interface PlanRenamePayload {
  subChatRenamed?: string;
  parentChatRenamed?: string;
}

export interface PlanRenameDeps {
  updateSubChatName(subChatId: string, name: string): void;
  markSubChatAutoRenamed(subChatId: string): void;
  patchChatGetCache(
    chatId: string,
    updater: (
      old: { subChats?: { id: string; name?: string | null }[] | null; name?: string | null } | null | undefined
    ) => unknown
  ): void;
  patchChatListCache(updater: (old: { id: string; name?: string | null }[] | undefined) => unknown): void;
}

export function applyPlanRename(
  eventSubChatId: string,
  chatId: string | null,
  renamed: PlanRenamePayload | undefined,
  deps: PlanRenameDeps
): void {
  if (!renamed || !chatId) return;
  const { subChatRenamed, parentChatRenamed } = renamed;

  if (subChatRenamed) {
    deps.updateSubChatName(eventSubChatId, subChatRenamed);
    deps.markSubChatAutoRenamed(eventSubChatId);
    deps.patchChatGetCache(chatId, (old) => {
      if (!old) return old;
      if (!Array.isArray(old.subChats)) return old;
      return {
        ...old,
        subChats: old.subChats.map((sc) => (sc.id === eventSubChatId ? { ...sc, name: subChatRenamed } : sc))
      };
    });
  }

  if (parentChatRenamed) {
    deps.patchChatGetCache(chatId, (old) => {
      if (!old) return old;
      return { ...old, name: parentChatRenamed };
    });
    deps.patchChatListCache((old) => {
      if (!Array.isArray(old)) return old;
      return old.map((c) => (c.id === chatId ? { ...c, name: parentChatRenamed } : c));
    });
  }
}
