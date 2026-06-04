/**
 * Canonical scope-key derivation.
 *
 * The single source of truth for building any keyed-state identifier (atom
 * family storage keys, terminal scope keys, dockview panel identities, …).
 *
 * Every key has the SAME deterministic shape:
 *
 *     t:<type>|p:<projectId>|w:<worktreePath>|c:<chatId>|s:<subChatId>
 *
 * - Labeled segments + a `|` separator (which never appears inside a UUID, so
 *   `-`-containing ids stay unambiguous) make it impossible to mistake a
 *   `chatId` for a `subChatId`. That is exactly the cross-namespace bug the old
 *   `subChatId ?? chatId` fallbacks caused.
 * - Any dimension that doesn't apply serialises to a stable EMPTY segment. The
 *   input placeholder convention is `undefined`/`null` → "" — never a different
 *   id.
 *
 * THE LOAD-BEARING INVARIANT (this is what actually prevents data leaks): for a
 * given scope `type`, the set of POPULATED dimensions is fixed and equals that
 * artifact's true identity, and the unused dimensions are ALWAYS the empty
 * placeholder — never "sometimes a real id". e.g. a plan is identified by its
 * sub-chat, so it is always `makeScopeKey('plan', { subChatId })` with
 * project/worktree/chat empty. Populating `chatId` there would fork the key for
 * the same plan whenever `chatId` was momentarily stale/null, reintroducing the
 * producer/consumer miss.
 *
 * NEVER hand-concatenate a key or use `?? / ||` across two id namespaces to
 * pick one. Always go through `makeScopeKey`.
 */

export type ScopeType = 'plan' | 'plan-content' | 'plan-refetch' | 'todos' | 'tasks' | 'terminal' | 'panel';

export interface ScopeParts {
  projectId?: string | null;
  worktreePath?: string | null;
  chatId?: string | null;
  subChatId?: string | null;
}

export function makeScopeKey(type: ScopeType, parts: ScopeParts): string {
  return `t:${type}|p:${parts.projectId ?? ''}|w:${parts.worktreePath ?? ''}|c:${parts.chatId ?? ''}|s:${parts.subChatId ?? ''}`;
}
