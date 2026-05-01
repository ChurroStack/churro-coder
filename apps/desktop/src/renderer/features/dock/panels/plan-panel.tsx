import type { IDockviewPanelProps } from "dockview-react"
import { useAtomValue, useSetAtom } from "jotai"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  pendingBuildPlanSubChatIdAtom,
  subChatModeAtomFamily,
} from "../../agents/atoms"
import { useAgentSubChatStore } from "../../agents/stores/sub-chat-store"
import { PlanSection } from "../../details-sidebar/sections/plan-section"
import type { PlanPanelEntity } from "../atoms"

/**
 * Full-panel view of a plan. Mirrors the sidebar's PlanWidget approve flow:
 * when the active sub-chat is in plan mode, render an "Approve" button that
 * sets `pendingBuildPlanSubChatIdAtom` — exactly the same atom the sidebar's
 * `handleApprovePlanFromSidebar` writes to. ChatViewInner's existing effect
 * picks it up and runs `handleApprovePlan` on the matching sub-chat, so we
 * don't duplicate any approval logic.
 */
export function PlanPanel({
  params,
  api,
  containerApi,
}: IDockviewPanelProps<PlanPanelEntity>) {
  const setPendingBuildPlan = useSetAtom(pendingBuildPlanSubChatIdAtom)
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  // Reading mode for the active sub-chat tracks the approve-button visibility
  // automatically when the user toggles between plan and agent modes.
  const mode = useAtomValue(subChatModeAtomFamily(activeSubChatId ?? ""))

  const handleApprove = () => {
    const id = useAgentSubChatStore.getState().activeSubChatId
    if (!id) return
    setPendingBuildPlan(id)
    // After approving, navigate back to the chat for this sub-chat (so the
    // user sees the agent start working) and close this plan panel — there
    // is nothing more to review.
    const chatPanel = containerApi.getPanel(`chat:${id}`)
    if (chatPanel) chatPanel.api.setActive()
    api.close()
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {mode === "plan" && (
        <div className="flex items-center justify-end gap-2 px-3 h-9 border-b border-border bg-muted/30 flex-shrink-0">
          <Button
            size="sm"
            onClick={handleApprove}
            className="h-6 px-3 text-xs font-medium rounded transition-transform duration-150 active:scale-[0.97]"
          >
            Approve
            <Kbd className="ml-1 text-primary-foreground/70">⌘↵</Kbd>
          </Button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <PlanSection
          chatId={params.chatId}
          planPath={params.planPath}
          isExpanded
        />
      </div>
    </div>
  )
}
