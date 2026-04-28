import { createContext, useContext, type ReactNode } from "react"
import type { DockviewApi, GridviewApi } from "dockview-react"

export interface DockHandles {
  dock: DockviewApi | null
  grid: GridviewApi | null
}

const DockContext = createContext<DockHandles>({ dock: null, grid: null })

export function DockProvider({
  value,
  children,
}: {
  value: DockHandles
  children: ReactNode
}) {
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>
}

export function useDockApi(): DockviewApi | null {
  return useContext(DockContext).dock
}

export function useGridApi(): GridviewApi | null {
  return useContext(DockContext).grid
}

export function useDockHandles(): DockHandles {
  return useContext(DockContext)
}
