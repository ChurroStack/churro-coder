import { useAtomValue } from "jotai"
import {
  expiredUserQuestionsAtom,
  pendingPlanApprovalsAtom,
  pendingUserQuestionsAtom,
} from "../../agents/atoms"
import { appStore } from "../../../lib/jotai-store"
import { isSubChatNeedingInput } from "./derive-status"

export function useSubChatNeedsInput(subChatId: string | null): boolean {
  const pendingQuestions = useAtomValue(pendingUserQuestionsAtom, { store: appStore })
  const expiredQuestions = useAtomValue(expiredUserQuestionsAtom, { store: appStore })
  const pendingPlanApprovals = useAtomValue(pendingPlanApprovalsAtom, { store: appStore })

  if (!subChatId) return false

  return isSubChatNeedingInput(subChatId, {
    subChatsWithPendingQuestions: new Set([
      ...pendingQuestions.keys(),
      ...expiredQuestions.keys(),
    ]),
    subChatsWithPendingPlanApprovals: new Set(pendingPlanApprovals.keys()),
  })
}
