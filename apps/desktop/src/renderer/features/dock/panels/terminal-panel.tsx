import { useEffect, useMemo } from "react"
import { useAtomValue } from "jotai"
import { useTheme } from "next-themes"
import { motion } from "motion/react"
import type { IDockviewPanelProps } from "dockview-react"
import { fullThemeDataAtom } from "@/lib/atoms"
import { Terminal } from "@/features/terminal/terminal"
import { getDefaultTerminalBg } from "@/features/terminal/helpers"
import {
  terminalsAtom,
  activeTerminalIdAtom,
} from "@/features/terminal/atoms"
import { useSetAtom } from "jotai"
import type { TerminalPanelEntity } from "../atoms"

/**
 * TerminalPanel — one dockview tab per terminal. The panel mounts a single
 * `<Terminal paneId={...} />`; the PTY survives mount/unmount via the
 * existing serialize/detach lifecycle in [terminal.tsx], so dragging the
 * panel between groups (or closing → reopening from the widget) keeps
 * `htop` running.
 *
 * Naming and the per-chat terminal list still live in the terminals store
 * (terminalsAtom) — this panel's title is read from `params.name` and the
 * panel's onWillClose handler removes the entry from the store. The dock
 * shell wires up store cleanup centrally (see DockShell.onDidRemovePanel).
 */
export function TerminalPanel({ params, api }: IDockviewPanelProps<TerminalPanelEntity>) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const fullThemeData = useAtomValue(fullThemeDataAtom)
  const setActiveIds = useSetAtom(activeTerminalIdAtom)
  const allTerminals = useAtomValue(terminalsAtom)

  // Resolve the latest name from the store so renames in TerminalTabs propagate
  // to the dockview tab title.
  const latestName = useMemo(() => {
    const list = allTerminals[params.chatId] ?? []
    const t = list.find((x) => x.paneId === params.paneId)
    return t?.name ?? params.name
  }, [allTerminals, params.chatId, params.paneId, params.name])

  useEffect(() => {
    if (latestName && latestName !== api.title) {
      api.setTitle(latestName)
    }
  }, [latestName, api])

  // Mark this terminal active in its chat scope when the panel becomes the
  // active panel — keeps the TerminalWidget summary in sync with what the
  // user is actually looking at.
  useEffect(() => {
    const sub = api.onDidActiveChange((event) => {
      if (!event.isActive) return
      const list = allTerminals[params.chatId] ?? []
      const t = list.find((x) => x.paneId === params.paneId)
      if (!t) return
      setActiveIds((prev) => ({ ...prev, [params.chatId]: t.id }))
    })
    return () => sub.dispose()
  }, [api, allTerminals, params.chatId, params.paneId, setActiveIds])

  const terminalBg = useMemo(() => {
    if (fullThemeData?.colors?.["terminal.background"]) {
      return fullThemeData.colors["terminal.background"]
    }
    if (fullThemeData?.colors?.["editor.background"]) {
      return fullThemeData.colors["editor.background"]
    }
    return getDefaultTerminalBg(isDark)
  }, [isDark, fullThemeData])

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{ backgroundColor: terminalBg }}
    >
      <motion.div
        key={params.paneId}
        className="h-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0 }}
      >
        <Terminal
          paneId={params.paneId}
          cwd={params.cwd}
          workspaceId={params.workspaceId}
          initialCwd={params.cwd}
        />
      </motion.div>
    </div>
  )
}
