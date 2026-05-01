import { createContext, useContext } from "react"

export interface DockWorkspaceContextValue {
  workspaceId: string | null
  active: boolean
}

const DockWorkspaceContext = createContext<DockWorkspaceContextValue>({
  workspaceId: null,
  active: true,
})

export const DockWorkspaceProvider = DockWorkspaceContext.Provider

export function useDockWorkspace() {
  return useContext(DockWorkspaceContext)
}
