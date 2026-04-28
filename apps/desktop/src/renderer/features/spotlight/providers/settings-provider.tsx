import { useMemo } from "react"
import { useSetAtom } from "jotai"
import { Settings as SettingsIcon, BarChart3 } from "lucide-react"
import { desktopViewAtom } from "../../agents/atoms"
import type { SpotlightItem, SpotlightProviderResult } from "../types"

function matches(query: string, item: { title: string; description?: string }) {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    item.title.toLowerCase().includes(q) ||
    (item.description?.toLowerCase().includes(q) ?? false)
  )
}

export function useSettingsProvider(
  query: string,
  enabled: boolean,
): SpotlightProviderResult {
  const setDesktopView = useSetAtom(desktopViewAtom)

  const items = useMemo<SpotlightItem[]>(() => {
    if (!enabled) return []

    const all: SpotlightItem[] = [
      {
        id: "settings:open",
        icon: <SettingsIcon className="h-4 w-4" />,
        title: "Settings",
        description: "Open the settings page",
        kbd: "⌘,",
        action: () => setDesktopView("settings"),
      },
      {
        id: "settings:usage",
        icon: <BarChart3 className="h-4 w-4" />,
        title: "Usage",
        description: "View usage and billing",
        action: () => setDesktopView("usage"),
      },
    ]

    return all.filter((item) => matches(query, item))
  }, [enabled, query, setDesktopView])

  return { groupTitle: "Settings", items }
}
