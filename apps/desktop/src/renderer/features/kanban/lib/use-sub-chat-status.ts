import { useAtomValue } from 'jotai';
import { expiredUserQuestionsAtom, pendingUserQuestionsAtom } from '../../agents/atoms';
import { appStore } from '../../../lib/jotai-store';
import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { usePendingPlanApprovals } from '../../agents/hooks/use-pending-plan-approvals';
import { isSubChatNeedingInput } from './derive-status';

export function useSubChatNeedsInput(subChatId: string | null): boolean {
  // Questions stay a live renderer atom (no DB equivalent). Plan approvals are
  // sourced from the DB query (single source of truth) scoped to the active
  // workspace's open tabs — react-query dedupes the per-tab callers.
  const pendingQuestions = useAtomValue(pendingUserQuestionsAtom, { store: appStore });
  const expiredQuestions = useAtomValue(expiredUserQuestionsAtom, { store: appStore });
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds);
  const { subChatIds: pendingPlanSubChatIds } = usePendingPlanApprovals(openSubChatIds);

  if (!subChatId) return false;

  return isSubChatNeedingInput(subChatId, {
    subChatsWithPendingQuestions: new Set([...pendingQuestions.keys(), ...expiredQuestions.keys()]),
    subChatsWithPendingPlanApprovals: pendingPlanSubChatIds
  });
}
