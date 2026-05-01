import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSidebarOpenAtom,
  devToolsUnlockedAtom,
} from "../../lib/atoms"
import { AgentsHeaderControls } from "../agents/ui/agents-header-controls"
import { desktopViewAtom } from "../agents/atoms"
import { AgentsAppearanceTab } from "../../components/dialogs/settings-tabs/agents-appearance-tab"
import { AgentsBetaTab } from "../../components/dialogs/settings-tabs/agents-beta-tab"
import { AgentsCustomAgentsTab } from "../../components/dialogs/settings-tabs/agents-custom-agents-tab"
import { AgentsDebugTab } from "../../components/dialogs/settings-tabs/agents-debug-tab"
import { AgentsKeyboardTab } from "../../components/dialogs/settings-tabs/agents-keyboard-tab"
import { AgentsMcpTab } from "../../components/dialogs/settings-tabs/agents-mcp-tab"
import { AgentsModelsTab } from "../../components/dialogs/settings-tabs/agents-models-tab"
import { AgentsPreferencesTab } from "../../components/dialogs/settings-tabs/agents-preferences-tab"
import { AgentsProfileTab } from "../../components/dialogs/settings-tabs/agents-profile-tab"
import { AgentsProjectsTab } from "../../components/dialogs/settings-tabs/agents-project-worktree-tab"
import { AgentsSkillsTab } from "../../components/dialogs/settings-tabs/agents-skills-tab"
import { AgentsPluginsTab } from "../../components/dialogs/settings-tabs/agents-plugins-tab"
import { AgentsSandboxTab } from "../../components/dialogs/settings-tabs/agents-sandbox-tab"

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV

export function SettingsContent() {
  const activeTab = useAtomValue(agentsSettingsDialogActiveTabAtom)
  const devToolsUnlocked = useAtomValue(devToolsUnlockedAtom)
  const showDebugTab = isDevelopment || devToolsUnlocked
  const setDesktopView = useSetAtom(desktopViewAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)

  // Escape key closes settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setDesktopView(null)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [setDesktopView])

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return <AgentsProfileTab />
      case "appearance":
        return <AgentsAppearanceTab />
      case "keyboard":
        return <AgentsKeyboardTab />
      case "preferences":
        return <AgentsPreferencesTab />
      case "models":
        return <AgentsModelsTab />
      case "skills":
        return <AgentsSkillsTab />
      case "agents":
        return <AgentsCustomAgentsTab />
      case "mcp":
        return <AgentsMcpTab />
      case "plugins":
        return <AgentsPluginsTab />
      case "projects":
        return <AgentsProjectsTab />
      case "beta":
        return <AgentsBetaTab />
      case "debug":
        return showDebugTab ? <AgentsDebugTab /> : null
      case "sandbox":
        return <AgentsSandboxTab />
      default:
        return null
    }
  }

  // Two-panel tabs need full width and height, no scroll wrapper
  const isTwoPanelTab = activeTab === "mcp" || activeTab === "skills" || activeTab === "agents" || activeTab === "projects" || activeTab === "keyboard" || activeTab === "plugins"

  // Drag region for window — floats as an absolute overlay so it doesn't
  // consume layout space. pointer-events:none lets clicks reach content
  // beneath; the inner wrapper re-enables them for the sidebar button.
  const dragBar = (
    <div
      className="absolute inset-x-0 top-0 h-12 flex items-center px-2 z-10"
      style={{
        WebkitAppRegion: "drag",
        pointerEvents: "none",
      } as React.CSSProperties}
    >
      <div style={{ pointerEvents: "auto" }}>
        <AgentsHeaderControls
          isSidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />
      </div>
    </div>
  )

  if (isTwoPanelTab) {
    return (
      <div className="relative h-full flex flex-col overflow-hidden">
        {dragBar}
        <div className="flex-1 min-h-0 overflow-hidden">
          {renderTabContent()}
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {dragBar}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {renderTabContent()}
        </div>
      </div>
    </div>
  )
}
