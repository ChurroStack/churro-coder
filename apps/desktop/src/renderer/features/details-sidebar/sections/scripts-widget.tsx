"use client"

import { memo, useCallback, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Play, Square, Settings2 } from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { newPanelPlacementAtom } from "../../../lib/atoms"
import {
  terminalsAtom,
  activeTerminalIdAtom,
  terminalSidebarOpenAtomFamily,
} from "../../terminal/atoms"
import {
  getScriptPaneId,
  getScriptTerminalId,
} from "../../terminal/utils"
import type { TerminalInstance } from "../../terminal/types"
import { useDockApi } from "../../dock/dock-context"
import { addOrFocus, resolvePlacementOpts } from "../../dock/add-or-focus"

const SESSION_POLL_INTERVAL_MS = 2000

interface ScriptsWidgetProps {
  chatId: string
  projectId: string | null
  worktreePath: string
  scopeKey: string
  onOpenSettings: () => void
}

interface ScriptRowProps {
  name: string
  command: string
  paneId: string
  isInTabs: boolean
  onRun: (name: string, command: string) => void
  onStop: (name: string) => void
}

const ScriptRow = memo(function ScriptRow({
  name,
  command,
  paneId,
  isInTabs,
  onRun,
  onStop,
}: ScriptRowProps) {
  // Poll the backend only while the tab is in our atom. While loading, treat
  // the script as alive so the button doesn't flip to "Run" between polls.
  const sessionQuery = trpc.terminal.getSession.useQuery(paneId, {
    enabled: isInTabs,
    refetchInterval: SESSION_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })

  const isAlive = useMemo(() => {
    if (!isInTabs) return false
    if (sessionQuery.data === undefined) return true // optimistic during first fetch
    return sessionQuery.data?.isAlive === true
  }, [isInTabs, sessionQuery.data])

  const isRunning = isInTabs && isAlive

  const handleClick = useCallback(() => {
    if (isRunning) {
      onStop(name)
      return
    }
    // Stopped — but if a dead tab is lingering, clean it up before re-running
    // so we get a fresh terminal rather than the "[Process exited]" pane.
    if (isInTabs) {
      onStop(name)
    }
    onRun(name, command)
  }, [isRunning, isInTabs, name, command, onRun, onStop])

  return (
    <div className="group/script flex items-center gap-1.5 min-h-[28px] rounded px-1.5 py-0.5 -ml-0.5 hover:bg-accent transition-colors">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "h-5 w-5 shrink-0 rounded flex items-center justify-center transition-colors",
          isRunning
            ? "text-destructive hover:bg-destructive/10"
            : "text-muted-foreground hover:text-foreground hover:bg-foreground/10",
        )}
        aria-label={isRunning ? `Stop ${name}` : `Run ${name}`}
        title={isRunning ? `Stop ${name}` : `Run ${name}`}
      >
        {isRunning ? (
          <Square className="h-3 w-3 fill-current" />
        ) : (
          <Play className="h-3 w-3 fill-current" />
        )}
      </button>
      <span className="text-xs text-foreground truncate flex-1 text-left">
        {name}
      </span>
      <code className="text-[10px] text-muted-foreground/70 truncate font-mono max-w-[55%]">
        {command}
      </code>
    </div>
  )
})

export const ScriptsWidget = memo(function ScriptsWidget({
  chatId,
  projectId,
  worktreePath,
  scopeKey,
  onOpenSettings,
}: ScriptsWidgetProps) {
  const { data: configData } = trpc.worktreeConfig.get.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  )

  const scripts = useMemo(
    () => configData?.config?.scripts ?? [],
    [configData?.config?.scripts],
  )

  const [allTerminals, setAllTerminals] = useAtom(terminalsAtom)
  const setAllActiveIds = useSetAtom(activeTerminalIdAtom)
  const setTerminalSidebarOpen = useSetAtom(
    terminalSidebarOpenAtomFamily(chatId),
  )
  const dockApi = useDockApi()
  const placement = useAtomValue(newPanelPlacementAtom)
  const killMutation = trpc.terminal.kill.useMutation()

  const tabsForScope = allTerminals[scopeKey] ?? []
  const runningPaneIds = useMemo(
    () => new Set(tabsForScope.map((t) => t.paneId)),
    [tabsForScope],
  )

  const handleRun = useCallback(
    (scriptName: string, command: string) => {
      const paneId = getScriptPaneId(scopeKey, scriptName)
      const id = getScriptTerminalId(scriptName)

      setAllTerminals((prev) => {
        const list = prev[scopeKey] ?? []
        if (list.some((t) => t.paneId === paneId)) return prev
        const next: TerminalInstance = {
          id,
          paneId,
          name: scriptName,
          createdAt: Date.now(),
          initialCommands: [command],
        }
        return { ...prev, [scopeKey]: [...list, next] }
      })
      setAllActiveIds((prev) => ({ ...prev, [scopeKey]: id }))

      if (dockApi) {
        addOrFocus(
          dockApi,
          {
            kind: "terminal",
            data: {
              paneId,
              name: scriptName,
              // Use scopeKey as chatId so TerminalPanel resolves the terminal
              // from allTerminals[scopeKey] (where script terminals are stored)
              // and cleanup in DockShell removes from the correct list.
              chatId: scopeKey,
              cwd: worktreePath,
              workspaceId: chatId,
              initialCommands: [command],
            },
          },
          resolvePlacementOpts(dockApi, placement, true, undefined),
        )
      } else {
        setTerminalSidebarOpen(true)
      }
    },
    [scopeKey, worktreePath, chatId, setAllTerminals, setAllActiveIds, dockApi, placement, setTerminalSidebarOpen],
  )

  const handleStop = useCallback(
    (scriptName: string) => {
      const paneId = getScriptPaneId(scopeKey, scriptName)
      // Best-effort kill; harmless if the pty is already dead.
      killMutation.mutate({ paneId })

      // Close the dockview panel so re-clicking Play spawns a fresh terminal
      // rather than focusing the stale dead one. DockShell's onDidRemovePanel
      // will also remove from allTerminals, making the setAllTerminals below
      // a no-op, which is fine.
      dockApi?.getPanel(`terminal:${paneId}`)?.api.close()

      setAllTerminals((prev) => {
        const list = prev[scopeKey] ?? []
        const next = list.filter((t) => t.paneId !== paneId)
        if (next.length === list.length) return prev
        return { ...prev, [scopeKey]: next }
      })
      setAllActiveIds((prev) => {
        const id = getScriptTerminalId(scriptName)
        if (prev[scopeKey] !== id) return prev
        const remaining = (allTerminals[scopeKey] ?? []).filter(
          (t) => t.paneId !== paneId,
        )
        const fallback = remaining[remaining.length - 1]?.id ?? null
        return { ...prev, [scopeKey]: fallback }
      })
    },
    [scopeKey, dockApi, killMutation, setAllTerminals, setAllActiveIds, allTerminals],
  )

  if (!projectId) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        No project selected
      </div>
    )
  }

  if (scripts.length === 0) {
    return (
      <div className="px-3 py-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          No scripts configured
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <Settings2 className="h-3 w-3" />
          Manage
        </button>
      </div>
    )
  }

  return (
    <div className="px-2 py-1.5 flex flex-col gap-0.5">
      {scripts.map((script) => {
        const paneId = getScriptPaneId(scopeKey, script.name)
        return (
          <ScriptRow
            key={script.name}
            name={script.name}
            command={script.command}
            paneId={paneId}
            isInTabs={runningPaneIds.has(paneId)}
            onRun={handleRun}
            onStop={handleStop}
          />
        )
      })}
    </div>
  )
})
