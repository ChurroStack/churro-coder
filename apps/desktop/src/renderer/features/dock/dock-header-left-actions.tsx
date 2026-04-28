import { useAtom, useAtomValue } from "jotai"
import { AlignJustify } from "lucide-react"
import type { IDockviewHeaderActionsProps } from "dockview-react"
import { Button } from "../../components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import { Kbd } from "../../components/ui/kbd"
import { useResolvedHotkeyDisplay } from "../../lib/hotkeys"
import {
  agentsSidebarOpenAtom,
  agentsUnseenChangesAtom,
} from "../../lib/atoms"

/**
 * Group-header actions at the *prefix* (left edge, before the tabs) of the
 * dockview tab strip. Wired via DockviewReact's
 * `prefixHeaderActionsComponent` so the button sits before the first tab,
 * not after the last one (`leftHeaderActionsComponent` is "left of the
 * void / right cluster", which still appears after tabs).
 *
 * Today owns the "open chats sidebar" toggle that used to live as
 * `AgentsHeaderControls` inside the chat content; placing it on the dock bar
 * puts every chrome control on one row.
 *
 * Only renders when the left rail is closed (otherwise the rail's own
 * header provides the toggle, and a duplicate would be confusing).
 */
export function DockHeaderLeftActions(_props: IDockviewHeaderActionsProps) {
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const unseen = useAtomValue(agentsUnseenChangesAtom)
  const hasUnseenChanges = unseen.size > 0
  const toggleSidebarHotkey = useResolvedHotkeyDisplay("toggle-sidebar")

  if (sidebarOpen) return null

  return (
    <div
      className="flex items-center h-full pl-2 pr-2 gap-0.5"
      style={{
        // @ts-expect-error - WebKit-specific property: keep buttons clickable
        WebkitAppRegion: "no-drag",
      }}
    >
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground relative"
          >
            <AlignJustify className="h-4 w-4" />
            {hasUnseenChanges && (
              <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-[#307BD0] ring-2 ring-background" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Open sidebar
          {toggleSidebarHotkey && <Kbd>{toggleSidebarHotkey}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
