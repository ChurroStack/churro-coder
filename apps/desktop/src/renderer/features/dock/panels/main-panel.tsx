import type { IDockviewPanelProps } from "dockview-react"
import { AgentsContent } from "../../agents/ui/agents-content"

/**
 * "Main" panel — fallback mounted by ChatPanelSync whenever there are no
 * `chat:*` panels. Two cases land here:
 *
 * 1. A workspace IS selected but its sub-chats list is empty / not yet
 *    loaded. AgentsContent below renders the ChatView for `selectedChatId`,
 *    which is the legacy single-chat path users get on first open of a
 *    workspace before they create extra sub-chats. Without this we'd show
 *    a blank "Workspace" tab.
 *
 * 2. No workspace selected. AgentsContent's desktop branch returns null
 *    in this state — the actual "no workspace" surface (New Workspace /
 *    Kanban / Settings / Usage / etc.) is rendered as a system-view
 *    overlay in [agents-layout.tsx]'s CenterRailPanel. We deliberately
 *    don't render the form here too; that would mount it twice, behind
 *    and on top of the overlay, and split keystroke/event handlers.
 */
export function MainPanel(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden">
      <AgentsContent />
    </div>
  )
}
