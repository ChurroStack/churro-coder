export type KanbanStatus = 'draft' | 'planning' | 'in-progress' | 'in-review' | 'done' | 'archived';
export type AttentionReason = 'pending-question' | 'pending-plan' | 'unseen-changes' | null;
export type SubChatMode = 'plan' | 'execute' | 'explore';

export type KanbanInput =
  | { kind: 'draft'; isVisible: boolean }
  | {
      kind: 'chat';
      chatId: string;
      archivedAt: Date | null;
      prUrl: string | null;
      /** All sub-chats for this workspace. Empty array iff workspace has none. */
      subChats: ReadonlyArray<{ id: string; mode: SubChatMode }>;
      /** IDs of sub-chats currently in loadingSubChatsAtom (subset of subChats[].id). */
      loadingSubChatIds: ReadonlySet<string>;
    };

export interface KanbanAttentionSignals {
  workspacesWithPendingQuestions: Set<string>;
  workspacesWithPendingApprovals: Set<string>;
  workspacesWithUnseenChanges: Set<string>;
}

/**
 * Derives the SDLC column for a card.
 * Returns null for non-visible drafts (caller should drop the card).
 *
 * Precedence: Archived > any-plan-subChat > Done(prUrl) > In-Progress(loading) > In-Review
 */
export function deriveKanbanStatus(input: KanbanInput): KanbanStatus | null {
  if (input.kind === 'draft') return input.isVisible ? 'draft' : null;
  if (input.archivedAt != null) return 'archived';

  const { subChats, loadingSubChatIds } = input;
  if (subChats.length === 0) return input.prUrl != null ? 'done' : 'planning';
  if (subChats.some((s) => s.mode === 'plan')) return 'planning';
  if (input.prUrl != null) return 'done';
  if (subChats.some((s) => loadingSubChatIds.has(s.id))) return 'in-progress';
  return 'in-review';
}

/**
 * Returns the highest-priority reason a workspace needs attention, or null.
 * Attention is null for drafts and archived workspaces.
 *
 * Precedence: pending-plan > pending-question > unseen-changes > null
 */
export function deriveAttentionReason(input: KanbanInput, signals: KanbanAttentionSignals): AttentionReason {
  if (input.kind === 'draft') return null;
  if (input.archivedAt != null) return null;

  const { chatId } = input;
  if (signals.workspacesWithPendingApprovals.has(chatId)) return 'pending-plan';
  if (signals.workspacesWithPendingQuestions.has(chatId)) return 'pending-question';
  if (signals.workspacesWithUnseenChanges.has(chatId)) return 'unseen-changes';
  return null;
}

// ---- backward-compat helpers (used by lib/use-sub-chat-status.ts) ----

interface SubChatNeedsInputDependencies {
  subChatsWithPendingQuestions: Set<string>;
  subChatsWithPendingPlanApprovals: Set<string>;
}

export function isSubChatNeedingInput(subChatId: string, deps: SubChatNeedsInputDependencies): boolean {
  return deps.subChatsWithPendingQuestions.has(subChatId) || deps.subChatsWithPendingPlanApprovals.has(subChatId);
}
