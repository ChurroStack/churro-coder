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
      /** Pre-resolved by the caller via pickLatestActiveSubChat. null iff zero sub-chats. */
      latestActiveSubChat: { id: string; mode: SubChatMode } | null;
      /** True iff any sub-chat of this workspace is in loadingSubChatsAtom. */
      isLoading: boolean;
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
 * Precedence: Archived > Done > Draft > mode-based switch
 */
export function deriveKanbanStatus(input: KanbanInput): KanbanStatus | null {
  if (input.kind === 'draft') {
    return input.isVisible ? 'draft' : null;
  }

  if (input.archivedAt != null) return 'archived';
  if (input.prUrl != null) return 'done';

  const mode = input.latestActiveSubChat?.mode ?? 'plan';
  if (mode === 'plan') return 'planning';
  // execute | explore
  if (input.isLoading) return 'in-progress';
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

/**
 * From a workspace's sub-chats, picks the single representative used for state derivation.
 * Rule: loading-wins (highest updatedAt among loading), then latest by updatedAt overall.
 */
export function pickLatestActiveSubChat(
  subChats: { id: string; mode: SubChatMode; updatedAt: Date }[],
  loadingSubChatIds: Set<string>
): { id: string; mode: SubChatMode; updatedAt: Date } | null {
  if (subChats.length === 0) return null;
  const loading = subChats.filter((s) => loadingSubChatIds.has(s.id));
  const pool = loading.length > 0 ? loading : subChats;
  return [...pool].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
}

// ---- backward-compat helpers (used by lib/use-sub-chat-status.ts) ----

interface SubChatNeedsInputDependencies {
  subChatsWithPendingQuestions: Set<string>;
  subChatsWithPendingPlanApprovals: Set<string>;
}

export function isSubChatNeedingInput(subChatId: string, deps: SubChatNeedsInputDependencies): boolean {
  return deps.subChatsWithPendingQuestions.has(subChatId) || deps.subChatsWithPendingPlanApprovals.has(subChatId);
}
