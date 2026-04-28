import type { ReactNode } from "react"

export interface SpotlightItem {
  id: string
  icon?: ReactNode
  title: string
  description?: string
  kbd?: string
  action: () => void | Promise<void>
}

export interface SpotlightProviderResult {
  groupTitle: string
  groupIcon?: ReactNode
  items: SpotlightItem[]
  loading?: boolean
}

export type SpotlightProvider = (
  query: string,
  enabled: boolean,
) => SpotlightProviderResult
