import {
  Plus,
  FileText,
  FileDiff,
  RotateCcw,
  MessageSquare,
  Terminal,
} from "lucide-react"
import { useAtom, useAtomValue } from "jotai"
import type { IDockviewHeaderActionsProps } from "dockview-react"
import { Button } from "../../components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import { Kbd } from "../../components/ui/kbd"
import { IconOpenSidebarRight } from "../../components/ui/icons"
import { useResolvedHotkeyDisplay } from "../../lib/hotkeys"
import { detailsSidebarOpenAtom } from "../details-sidebar/atoms"
import { visibleDockLaunchButtonsAtom } from "../../lib/atoms"
import { usePanelActions } from "./use-panel-actions"

/**
 * Group-header actions on the right side of the dockview tab strip.
 * Launch icons are user-configurable via visibleDockLaunchButtonsAtom;
 * hidden buttons fall back to the [+] dropdown.
 */
export function DockHeaderActions(props: IDockviewHeaderActionsProps) {
  const actions = usePanelActions(props.group)
  const [isDetailsOpen, setIsDetailsOpen] = useAtom(detailsSidebarOpenAtom)
  const toggleDetailsHotkey = useResolvedHotkeyDisplay("toggle-details")
  const visibleButtons = useAtomValue(visibleDockLaunchButtonsAtom)

  const showNewChat       = visibleButtons.includes("newChat")
  const showToggle        = visibleButtons.includes("toggleDetails")
  const showPlanIcon      = visibleButtons.includes("openPlan")
  const showChangesIcon   = visibleButtons.includes("openChanges")
  const showTerminalIcon  = visibleButtons.includes("newTerminal")

  // Buttons hidden from the icon row that overflow into the Plus menu
  const menuPlan     = !showPlanIcon
  const menuChanges  = !showChangesIcon
  const menuTerminal = !showTerminalIcon

  return (
    <div
      className="flex items-center h-full px-1 gap-0.5"
      style={{ WebkitAppRegion: "no-drag" }}
    >
      {showNewChat && (
        <HeaderIconButton
          tooltip="New chat"
          ariaLabel="New chat"
          icon={<MessageSquare className="h-4 w-4" />}
          disabled={!actions.canNewSubChat}
          onClick={actions.newSubChat}
        />
      )}

      {showPlanIcon && (
        <HeaderIconButton
          tooltip="Show plan"
          ariaLabel="Show plan"
          icon={<FileText className="h-4 w-4" />}
          disabled={!actions.canOpenPlan}
          onClick={actions.openPlan}
        />
      )}

      {showChangesIcon && (
        <HeaderIconButton
          tooltip="Show changes"
          ariaLabel="Show changes"
          icon={<FileDiff className="h-4 w-4" />}
          disabled={!actions.canOpenDiff}
          onClick={actions.openDiff}
        />
      )}

      {showTerminalIcon && (
        <HeaderIconButton
          tooltip="New terminal"
          ariaLabel="New terminal"
          icon={<Terminal className="h-4 w-4" />}
          disabled={!actions.canOpenTerminal}
          onClick={actions.openTerminal}
        />
      )}

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open a panel"
                className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open a panel</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          {menuTerminal && (
            <DropdownMenuItem
              disabled={!actions.canOpenTerminal}
              onClick={actions.openTerminal}
            >
              <Terminal className="h-4 w-4 mr-2" />
              New Terminal
            </DropdownMenuItem>
          )}
          {menuPlan && (
            <DropdownMenuItem
              disabled={!actions.canOpenPlan}
              onClick={actions.openPlan}
            >
              <FileText className="h-4 w-4 mr-2" />
              Show Plan
            </DropdownMenuItem>
          )}
          {menuChanges && (
            <DropdownMenuItem
              disabled={!actions.canOpenDiff}
              onClick={actions.openDiff}
            >
              <FileDiff className="h-4 w-4 mr-2" />
              Show Changes
            </DropdownMenuItem>
          )}
          {(menuTerminal || menuPlan || menuChanges) && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={actions.resetLayout}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset layout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={isDetailsOpen ? "Hide details" : "View details"}
              onClick={() => setIsDetailsOpen(!isDetailsOpen)}
              data-active={isDetailsOpen}
              className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground data-[active=true]:bg-foreground/10 data-[active=true]:text-foreground"
            >
              <IconOpenSidebarRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isDetailsOpen ? "Hide details" : "View details"}
            {toggleDetailsHotkey && <Kbd>{toggleDetailsHotkey}</Kbd>}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

interface HeaderIconButtonProps {
  tooltip: string
  ariaLabel: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}

function HeaderIconButton({
  tooltip,
  ariaLabel,
  icon,
  disabled,
  onClick,
}: HeaderIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={onClick}
          className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
