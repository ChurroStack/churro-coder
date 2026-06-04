import { useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { selectedAgentChatIdAtom } from '../atoms';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { api } from '../../../lib/mock-api';

/**
 * The single, validated source of truth for "which workspace + sub-chat is the
 * right sidebar (and anything else that follows the active workspace) looking
 * at right now".
 *
 * Why this exists: there are two independent sources of truth for the active
 * identity — `selectedAgentChatIdAtom` (jotai) and the `useAgentSubChatStore`
 * (zustand) — and they update one render apart during a workspace switch. Any
 * code that read `chatId` from the atom but `activeSubChatId` from the store
 * could observe a NEW chat with the OLD chat's sub-chat, and render the
 * previous workspace's data. This hook resolves a single consistent tuple and
 * GUARANTEES it never emits a `subChatId` that doesn't belong to `chatId`.
 *
 * Contract:
 * - `chatId` / `projectId` / `worktreePath` / `sandboxId` are chat-level and
 *   surface as soon as the chat record for the SELECTED chat resolves. They are
 *   nulled while the chat record is for a different (stale) chat — defending
 *   against the `getAgentChat` snapshot carrier + `placeholderData`.
 * - `subChatId` is the GUARDED field: non-null only when the store is in sync
 *   with the selected chat AND the candidate is a real open sub-chat of it.
 *   When null, consumers MUST render their empty state — never fall back to
 *   `chatId` or `'default'`.
 */
/**
 * The validated chat record (the `getAgentChat` payload). Structurally typed for
 * the fields consumers commonly read; the rest of the payload is preserved.
 */
export interface WorkspaceChatRecord {
  id?: string;
  worktreePath?: string | null;
  sandboxId?: string | null;
  projectId?: string | null;
  prNumber?: number | null;
  meta?: { repository?: string; branch?: string | null };
  [key: string]: unknown;
}

export interface WorkspaceIdentity {
  projectId: string | null;
  chatId: string | null;
  worktreePath: string | null;
  sandboxId: string | null;
  /** GUARDED — null mid-switch / unresolved. Never a foreign workspace's sub-chat. */
  subChatId: string | null;
  /**
   * The validated chat record, or null while the fetched record is for a stale
   * chat / still loading. Use for chat-level fields not already surfaced
   * (e.g. `meta`, `prNumber`) so callers don't re-fetch `getAgentChat`.
   */
  chatRecord: WorkspaceChatRecord | null;
  /** Open sub-chats for the active chat (empty while not in sync). */
  openSubChatIds: string[];
  /** True while the store's chatId !== selectedChatId (switching / hydrating). */
  isResolvingSubChat: boolean;
  /** Remote/sandbox chat with no local worktree. */
  isRemoteChat: boolean;
}

/**
 * Pure resolver for the guarded sub-chat id. Extracted so the invariant can be
 * unit-tested without React. The `openSubChatIds[0]` fallback covers the
 * legitimate cold-mount race (a CLI panel is mounted under its own subChatId
 * but `setActiveSubChat` hasn't fired yet) — but ONLY when `inSync`, so it can
 * only ever pick a sub-chat of the CURRENT chat. There is intentionally no
 * `?? chatId` rung: a chatId is never a valid sub-chat id.
 */
export function resolveValidatedSubChatId(
  inSync: boolean,
  activeSubChatId: string | null,
  openSubChatIds: string[],
  allSubChats: { id: string }[]
): string | null {
  if (!inSync) return null;
  const candidate = activeSubChatId ?? openSubChatIds[0] ?? null;
  if (!candidate) return null;
  if (!openSubChatIds.includes(candidate)) return null;
  // Once allSubChats has hydrated from the DB, the candidate must be a real
  // sub-chat of this chat. While it's still empty (cold start / pre-hydration)
  // we trust localStorage's active id rather than blanking the sidebar.
  if (allSubChats.length > 0 && !allSubChats.some((sc) => sc.id === candidate)) return null;
  return candidate;
}

const IS_DEV =
  typeof import.meta !== 'undefined' && (import.meta.env?.DEV === true || import.meta.env?.MODE === 'test');

export function useWorkspaceIdentity(): WorkspaceIdentity {
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom);
  const storeChatId = useAgentSubChatStore((s) => s.chatId);
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId);
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds);
  const allSubChats = useAgentSubChatStore((s) => s.allSubChats);

  const { data: chat } = api.agents.getAgentChat.useQuery(
    { chatId: selectedChatId ?? '' },
    { enabled: !!selectedChatId }
  );

  // The store can only be trusted for sub-chat resolution when it describes the
  // same chat the user has selected. This single comparison is what closes the
  // two-source desync window.
  const inSync = !!selectedChatId && storeChatId === selectedChatId;

  // The chat record is only trustworthy when it is FOR the selected chat. The
  // mock-api snapshot carrier can momentarily hold the previous chat's record.
  const chatMatches = !!selectedChatId && (chat as { id?: string } | null)?.id === selectedChatId;

  const dbSubChatIds = useMemo(() => {
    const ids = (chat as { subChats?: { id: string }[] } | null)?.subChats?.map((s) => s.id);
    return ids ?? null;
  }, [chat]);

  const subChatId = useMemo(() => {
    const candidate = resolveValidatedSubChatId(inSync, activeSubChatId, openSubChatIds, allSubChats);
    // Final backstop: cross-check against the DB record's own sub-chat list when
    // available. If the store drifted (a switch bypassed selectWorkspace), never
    // leak — render empty.
    if (candidate && chatMatches && dbSubChatIds && !dbSubChatIds.includes(candidate)) {
      return null;
    }
    return candidate;
  }, [inSync, activeSubChatId, openSubChatIds, allSubChats, chatMatches, dbSubChatIds]);

  // Dev/test guardrail: fire loudly if the store ever drifts from the DB record
  // so a regression surfaces as a logged invariant violation, not silent wrong
  // data. (The render value above already downgraded to null.)
  useEffect(() => {
    if (!IS_DEV) return;
    const candidate = resolveValidatedSubChatId(inSync, activeSubChatId, openSubChatIds, allSubChats);
    if (candidate && chatMatches && dbSubChatIds && !dbSubChatIds.includes(candidate)) {
      console.error(
        `[workspace-identity] INVARIANT VIOLATION: store emitted subChatId=${candidate} that does not ` +
          `belong to chatId=${selectedChatId} (db sub-chats: ${dbSubChatIds.join(',')}). ` +
          `A workspace switch bypassed selectWorkspace().`
      );
    }
  }, [inSync, activeSubChatId, openSubChatIds, allSubChats, chatMatches, dbSubChatIds, selectedChatId]);

  const chatRecord = chatMatches ? ((chat as WorkspaceChatRecord) ?? null) : null;
  const worktreePath = chatRecord?.worktreePath ?? null;
  const sandboxId = chatRecord?.sandboxId ?? null;
  const projectId = chatRecord?.projectId ?? null;

  return {
    projectId,
    chatId: selectedChatId,
    worktreePath,
    sandboxId,
    subChatId,
    chatRecord,
    openSubChatIds: inSync ? openSubChatIds : [],
    isResolvingSubChat: !!selectedChatId && !inSync,
    isRemoteChat: !worktreePath && !!sandboxId
  };
}
