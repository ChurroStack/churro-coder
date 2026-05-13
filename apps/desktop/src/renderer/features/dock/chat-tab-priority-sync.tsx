import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import type { DockviewApi } from 'dockview-react';
import { useStreamingStatusStore, type StreamingStatus } from '../agents/stores/streaming-status-store';
import { pendingUserQuestionsAtom, expiredUserQuestionsAtom, pendingPlanApprovalsAtom } from '../agents/atoms/index';
import { useAgentSubChatStore } from '../agents/stores/sub-chat-store';

export interface ChatTabPrioritySyncProps {
  workspaceId: string | null;
  active: boolean;
  dockApi: DockviewApi | null;
}

export type PromotionReason = 'streaming' | 'needs-input' | 'error';

export function isActive(
  subChatId: string,
  statuses: Record<string, StreamingStatus>,
  pendingQIds: Set<string>,
  pendingPlanIds: Set<string>
): boolean {
  const status = statuses[subChatId] ?? 'ready';
  return (
    status === 'streaming' ||
    status === 'submitted' ||
    status === 'error' ||
    pendingQIds.has(subChatId) ||
    pendingPlanIds.has(subChatId)
  );
}

export function reasonFor(
  subChatId: string,
  statuses: Record<string, StreamingStatus>,
  pendingQIds: Set<string>,
  pendingPlanIds: Set<string>
): PromotionReason {
  const status = statuses[subChatId] ?? 'ready';
  if (status === 'streaming' || status === 'submitted') return 'streaming';
  if (status === 'error') return 'error';
  return 'needs-input';
}

/**
 * ChatTabPrioritySync — when a chat transitions from passive to active
 * (streaming, needs-input, or error), promotes its tab to index 0 within
 * its dockview group so the user can always see their in-progress work
 * without hunting the overflow dropdown.
 *
 * Only the active workspace's instance runs; others are no-ops.
 * Uses skipSetActive so the currently focused tab is not changed.
 */
export function ChatTabPrioritySync({ workspaceId, active, dockApi }: ChatTabPrioritySyncProps) {
  const storeChatId = useAgentSubChatStore((s) => s.chatId);
  const statuses = useStreamingStatusStore((s) => s.statuses);
  const pendingUserQuestions = useAtomValue(pendingUserQuestionsAtom);
  const expiredUserQuestions = useAtomValue(expiredUserQuestionsAtom);
  const pendingPlanApprovals = useAtomValue(pendingPlanApprovalsAtom);

  // Track previous "active" value per subChatId to detect false→true transitions.
  const prevActive = useRef<Map<string, boolean>>(new Map());
  // First effect run after activation is observation-only: seed the map from
  // current state without moving panels. Without this, on initial mount /
  // workspace switch every currently-active chat would look like a fresh
  // transition and get promoted to index 0, re-sorting the user's strip.
  const hasSeeded = useRef(false);

  useEffect(() => {
    if (!active || !dockApi || !workspaceId) return;
    if (storeChatId !== workspaceId) return;

    const pendingQIds = new Set([...pendingUserQuestions.keys(), ...expiredUserQuestions.keys()]);
    const pendingPlanIds = new Set(pendingPlanApprovals.keys());
    const seeding = !hasSeeded.current;
    const seen = new Set<string>();

    for (const panel of dockApi.panels) {
      if (!panel.id.startsWith('chat:')) continue;
      const subChatId = panel.id.slice('chat:'.length);
      seen.add(subChatId);

      const nowActive = isActive(subChatId, statuses, pendingQIds, pendingPlanIds);
      const wasActive = prevActive.current.get(subChatId) ?? false;

      if (!seeding && !wasActive && nowActive) {
        const group = panel.api.group;
        const panels = group.panels;
        if (panels.length > 0 && panels[0].id !== panel.id) {
          panel.api.moveTo({ group, index: 0, skipSetActive: true });
          console.debug(
            '[tab-priority] promote',
            subChatId,
            reasonFor(subChatId, statuses, pendingQIds, pendingPlanIds)
          );
        }
      }

      prevActive.current.set(subChatId, nowActive);
    }

    // Drop entries for panels that no longer exist so the map doesn't grow
    // unboundedly across a long session.
    for (const key of prevActive.current.keys()) {
      if (!seen.has(key)) prevActive.current.delete(key);
    }

    if (seeding) hasSeeded.current = true;
  }, [
    active,
    dockApi,
    workspaceId,
    storeChatId,
    statuses,
    pendingUserQuestions,
    expiredUserQuestions,
    pendingPlanApprovals
  ]);

  return null;
}
