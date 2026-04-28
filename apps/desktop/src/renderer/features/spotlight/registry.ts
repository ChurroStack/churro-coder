import { useSettingsProvider } from "./providers/settings-provider"
import { useSuggestionProvider } from "./providers/suggestion-provider"
import { useWorkspaceFileProvider } from "./providers/workspace-file-provider"
import { useWorkspaceTabsProvider } from "./providers/workspace-tabs-provider"
import { useWorkspacesSearchProvider } from "./providers/workspaces-search-provider"
import type { SpotlightProvider } from "./types"

export interface SpotlightProviderRegistration {
  id: string
  scope: "global" | "workspace"
  hook: SpotlightProvider
}

export const SPOTLIGHT_PROVIDERS: SpotlightProviderRegistration[] = [
  { id: "suggestions", scope: "workspace", hook: useSuggestionProvider },
  { id: "tabs", scope: "workspace", hook: useWorkspaceTabsProvider },
  { id: "files", scope: "workspace", hook: useWorkspaceFileProvider },
  { id: "workspaces", scope: "global", hook: useWorkspacesSearchProvider },
  { id: "settings", scope: "global", hook: useSettingsProvider },
]
