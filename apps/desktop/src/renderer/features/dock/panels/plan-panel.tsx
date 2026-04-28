import type { IDockviewPanelProps } from "dockview-react"
import { PlanSection } from "../../details-sidebar/sections/plan-section"
import type { PlanPanelEntity } from "../atoms"

export function PlanPanel({ params }: IDockviewPanelProps<PlanPanelEntity>) {
  return (
    <div className="h-full w-full overflow-hidden">
      <PlanSection
        chatId={params.chatId}
        planPath={params.planPath}
        isExpanded
      />
    </div>
  )
}
