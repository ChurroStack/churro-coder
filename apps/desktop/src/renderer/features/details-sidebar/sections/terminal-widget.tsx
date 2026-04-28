"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useAtom, useAtomValue } from "jotai"
import { useTheme } from "next-themes"
import { fullThemeDataAtom } from "@/lib/atoms"
import { motion } from "motion/react"
import { ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlusIcon } from "@/components/ui/icons"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { useResolvedHotkeyDisplay } from "@/lib/hotkeys"
import { Terminal } from "@/features/terminal/terminal"
import { TerminalTabs } from "@/features/terminal/terminal-tabs"
import { getDefaultTerminalBg } from "@/features/terminal/helpers"
import {
  terminalsAtom,
  activeTerminalIdAtom,
  terminalCwdAtom,
} from "@/features/terminal/atoms"
import { trpc } from "@/lib/trpc"
import type { TerminalInstance } from "@/features/terminal/types"
import { cn } from "@/lib/utils"
import { useWidgetPanel } from "../../dock"
import { PromotedToPanelStub } from "./promoted-to-panel-stub"

interface TerminalWidgetProps {
  chatId: string
  cwd: string
  workspaceId: string
  onExpand?: () => void
}

function generateTerminalId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function generatePaneId(chatId: string, terminalId: string): string {
  return `${chatId}:term:${terminalId}`
}

function getNextTerminalName(terminals: TerminalInstance[]): string {
  const existingNumbers = terminals
    .map((t) => {
      const match = t.name.match(/^Terminal (\d+)$/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => n > 0)

  const maxNumber =
    existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0
  return `Terminal ${maxNumber + 1}`
}

/**
 * Terminal Widget for Overview Sidebar
 * Combines WidgetCard header with terminal tabs and content
 * Memoized to prevent re-renders when parent updates
 */
export const TerminalWidget = memo(function TerminalWidget({
  chatId,
  cwd,
  workspaceId,
  onExpand,
}: TerminalWidgetProps) {
  // Terminal state - reuse existing atoms
  const [allTerminals, setAllTerminals] = useAtom(terminalsAtom)
  const [allActiveIds, setAllActiveIds] = useAtom(activeTerminalIdAtom)
  const terminalCwds = useAtomValue(terminalCwdAtom)

  // Resolve the active terminal's identity up-front so the widget mutex can
  // bind to its `paneId` (each terminal is now its own dockview panel — see
  // [terminal-panel.tsx]). When no terminal exists yet the mutex no-ops; the
  // useEffect below auto-creates one on mount.
  const terminalsForChat = useMemo(
    () => allTerminals[chatId] || [],
    [allTerminals, chatId],
  )
  const activeIdForChat = useMemo(
    () => allActiveIds[chatId] || null,
    [allActiveIds, chatId],
  )
  const activeTerminalEntity = useMemo(() => {
    const t = terminalsForChat.find((x) => x.id === activeIdForChat)
    return t ? { paneId: t.paneId, name: t.name } : null
  }, [terminalsForChat, activeIdForChat])

  // Widget ↔ panel mutex keyed on the *active* terminal's paneId. When the
  // active terminal is promoted to a dockview tab, the widget summary
  // collapses to a "Bring back to summary" stub. PTYs are preserved by the
  // serialize/detach lifecycle in [terminal.tsx].
  const widgetPanel = useWidgetPanel("terminal", {
    kind: "terminal",
    data: {
      paneId: activeTerminalEntity?.paneId ?? "__none__",
      name: activeTerminalEntity?.name ?? "Terminal",
      chatId,
      cwd,
      workspaceId,
    },
  })

  const handleExpand = useCallback(() => {
    if (!activeTerminalEntity) return
    if (widgetPanel.available) {
      widgetPanel.openAsPanel()
    } else {
      onExpand?.()
    }
  }, [activeTerminalEntity, widgetPanel, onExpand])

  // Theme detection for terminal background
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const fullThemeData = useAtomValue(fullThemeDataAtom)

  // Resolved hotkey for tooltip
  const toggleTerminalHotkey = useResolvedHotkeyDisplay("toggle-terminal")

  const terminalBg = useMemo(() => {
    if (fullThemeData?.colors?.["terminal.background"]) {
      return fullThemeData.colors["terminal.background"]
    }
    if (fullThemeData?.colors?.["editor.background"]) {
      return fullThemeData.colors["editor.background"]
    }
    return getDefaultTerminalBg(isDark)
  }, [isDark, fullThemeData])

  // Aliases — declared earlier as terminalsForChat / activeIdForChat for
  // mutex setup; reuse them under the names the rest of this component uses.
  const terminals = terminalsForChat
  const activeTerminalId = activeIdForChat
  const activeTerminal = useMemo(
    () => terminals.find((t) => t.id === activeTerminalId) || null,
    [terminals, activeTerminalId],
  )

  const killMutation = trpc.terminal.kill.useMutation()

  // Refs for stable callbacks
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals
  const activeTerminalIdRef = useRef(activeTerminalId)
  activeTerminalIdRef.current = activeTerminalId

  const createTerminal = useCallback(() => {
    const currentChatId = chatIdRef.current
    const currentTerminals = terminalsRef.current

    const id = generateTerminalId()
    const paneId = generatePaneId(currentChatId, id)
    const name = getNextTerminalName(currentTerminals)

    const newTerminal: TerminalInstance = {
      id,
      paneId,
      name,
      createdAt: Date.now(),
    }

    setAllTerminals((prev) => ({
      ...prev,
      [currentChatId]: [...(prev[currentChatId] || []), newTerminal],
    }))

    setAllActiveIds((prev) => ({
      ...prev,
      [currentChatId]: id,
    }))
  }, [setAllTerminals, setAllActiveIds])

  const selectTerminal = useCallback(
    (id: string) => {
      const currentChatId = chatIdRef.current
      setAllActiveIds((prev) => ({
        ...prev,
        [currentChatId]: id,
      }))
    },
    [setAllActiveIds],
  )

  // Confirm-on-destructive-close. Closing any terminal kills its PTY (and
  // any running command with it), so each of the three close paths below
  // queues a pending confirmation instead of acting immediately. The
  // dispatcher captures an `apply` closure so the dialog handler doesn't
  // need to know which path it came from. Cancel resets the state.
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string
    description: ReactNode
    apply: () => void
  } | null>(null)

  const requestConfirm = useCallback(
    (title: string, description: ReactNode, apply: () => void) => {
      setPendingConfirm({ title, description, apply })
    },
    [],
  )

  const closeTerminal = useCallback(
    (id: string) => {
      const terminal = terminalsRef.current.find((t) => t.id === id)
      if (!terminal) return
      requestConfirm(
        "Close terminal",
        <>
          Closing{" "}
          <span className="font-medium text-foreground">{terminal.name}</span>{" "}
          will kill any running commands.
        </>,
        () => {
          const currentChatId = chatIdRef.current
          const currentTerminals = terminalsRef.current
          const currentActiveId = activeTerminalIdRef.current

          killMutation.mutate({ paneId: terminal.paneId })

          const newTerminals = currentTerminals.filter((t) => t.id !== id)
          setAllTerminals((prev) => ({
            ...prev,
            [currentChatId]: newTerminals,
          }))

          if (currentActiveId === id) {
            const newActive = newTerminals[newTerminals.length - 1]?.id || null
            setAllActiveIds((prev) => ({
              ...prev,
              [currentChatId]: newActive,
            }))
          }
        },
      )
    },
    [requestConfirm, setAllTerminals, setAllActiveIds, killMutation],
  )

  const renameTerminal = useCallback(
    (id: string, name: string) => {
      const currentChatId = chatIdRef.current
      setAllTerminals((prev) => ({
        ...prev,
        [currentChatId]: (prev[currentChatId] || []).map((t) =>
          t.id === id ? { ...t, name } : t,
        ),
      }))
    },
    [setAllTerminals],
  )

  const closeOtherTerminals = useCallback(
    (id: string) => {
      const others = terminalsRef.current.filter((t) => t.id !== id)
      if (others.length === 0) return
      requestConfirm(
        "Close other terminals",
        <>
          Closing {others.length} other terminal
          {others.length === 1 ? "" : "s"} will kill any running commands.
        </>,
        () => {
          const currentChatId = chatIdRef.current
          const currentTerminals = terminalsRef.current

          currentTerminals.forEach((terminal) => {
            if (terminal.id !== id) {
              killMutation.mutate({ paneId: terminal.paneId })
            }
          })

          const remainingTerminal = currentTerminals.find((t) => t.id === id)
          setAllTerminals((prev) => ({
            ...prev,
            [currentChatId]: remainingTerminal ? [remainingTerminal] : [],
          }))

          setAllActiveIds((prev) => ({
            ...prev,
            [currentChatId]: id,
          }))
        },
      )
    },
    [requestConfirm, setAllTerminals, setAllActiveIds, killMutation],
  )

  const closeTerminalsToRight = useCallback(
    (id: string) => {
      const currentTerminals = terminalsRef.current
      const index = currentTerminals.findIndex((t) => t.id === id)
      if (index === -1) return
      const toClose = currentTerminals.slice(index + 1)
      if (toClose.length === 0) return
      requestConfirm(
        "Close terminals to the right",
        <>
          Closing {toClose.length} terminal
          {toClose.length === 1 ? "" : "s"} will kill any running commands.
        </>,
        () => {
          const currentChatId = chatIdRef.current
          const fresh = terminalsRef.current
          const freshIndex = fresh.findIndex((t) => t.id === id)
          if (freshIndex === -1) return
          const terminalsToClose = fresh.slice(freshIndex + 1)
          terminalsToClose.forEach((terminal) => {
            killMutation.mutate({ paneId: terminal.paneId })
          })
          const remainingTerminals = fresh.slice(0, freshIndex + 1)
          setAllTerminals((prev) => ({
            ...prev,
            [currentChatId]: remainingTerminals,
          }))
          const currentActiveId = activeTerminalIdRef.current
          if (
            currentActiveId &&
            !remainingTerminals.find((t) => t.id === currentActiveId)
          ) {
            setAllActiveIds((prev) => ({
              ...prev,
              [currentChatId]:
                remainingTerminals[remainingTerminals.length - 1]?.id || null,
            }))
          }
        },
      )
    },
    [requestConfirm, setAllTerminals, setAllActiveIds, killMutation],
  )

  // Auto-create first terminal when section is rendered and no terminals exist
  useEffect(() => {
    if (terminals.length === 0) {
      createTerminal()
    }
  }, [terminals.length, createTerminal])

  // Delay terminal rendering slightly
  const [canRenderTerminal, setCanRenderTerminal] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setCanRenderTerminal(true)
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // Confirm dialog rendered next to whichever branch is active so the
  // pending state stays alive across the promote-to-panel transition.
  const confirmDialog = (
    <AlertDialog
      open={!!pendingConfirm}
      onOpenChange={(open) => {
        if (!open) setPendingConfirm(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription className="px-5 pb-5">
          {pendingConfirm?.description}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPendingConfirm(null)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            autoFocus
            onClick={() => {
              const apply = pendingConfirm?.apply
              setPendingConfirm(null)
              apply?.()
            }}
          >
            Close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // Promoted to a dockview panel — render the stub instead of the summary.
  if (widgetPanel.isOpen) {
    return (
      <>
        <PromotedToPanelStub
          label="Terminal"
          onReturnToSummary={widgetPanel.closePanel}
        />
        {confirmDialog}
      </>
    )
  }

  return (
    <>
    <div className="mx-2 mb-2">
      <div className={cn("rounded-lg border border-border/50 overflow-hidden")}>
        {/* Widget Header with Tabs - like terminal-sidebar.tsx */}
        <div
          className="flex items-center gap-1 pl-1 pr-2 py-1.5 select-none group"
          style={{ backgroundColor: terminalBg }}
        >
          {/* Terminal Tabs - directly without wrapper, like in terminal-sidebar.tsx */}
          {terminals.length > 0 && (
            <TerminalTabs
              terminals={terminals}
              activeTerminalId={activeTerminalId}
              cwds={terminalCwds}
              initialCwd={cwd}
              terminalBg={terminalBg}
              hidePlusButton
              small
              onSelectTerminal={selectTerminal}
              onCloseTerminal={closeTerminal}
              onCloseOtherTerminals={closeOtherTerminals}
              onCloseTerminalsToRight={closeTerminalsToRight}
              onCreateTerminal={createTerminal}
              onRenameTerminal={renameTerminal}
            />
          )}

          {/* Plus button after tabs */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={createTerminal}
                className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] rounded-md flex-shrink-0"
                aria-label="New terminal"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New terminal</TooltipContent>
          </Tooltip>

          {/* Expand to sidebar / panel button */}
          {(onExpand || widgetPanel.available) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleExpand}
                  className="h-5 w-5 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground rounded-md opacity-0 group-hover:opacity-100 transition-[background-color,opacity,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0"
                  aria-label="Expand terminal"
                >
                  <ArrowUpRight className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Expand to sidebar
                {toggleTerminalHotkey && <Kbd>{toggleTerminalHotkey}</Kbd>}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Terminal Content */}
        <div
          className="min-h-0 overflow-hidden"
          style={{ backgroundColor: terminalBg, height: "200px" }}
        >
          {activeTerminal && canRenderTerminal ? (
            <motion.div
              key={activeTerminal.paneId}
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0 }}
            >
              <Terminal
                paneId={activeTerminal.paneId}
                cwd={cwd}
                workspaceId={workspaceId}
                initialCommands={activeTerminal.initialCommands}
                initialCwd={cwd}
              />
            </motion.div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {!canRenderTerminal ? "" : "No terminal open"}
            </div>
          )}
        </div>
      </div>
    </div>
    {confirmDialog}
    </>
  )
})
