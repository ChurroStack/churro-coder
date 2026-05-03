// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react"
import { render, type RenderOptions, type RenderResult } from "@testing-library/react"
import { Provider as JotaiProvider } from "jotai"
import { createTestStore, type TestStore } from "./create-test-store"

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  store?: TestStore
}

export interface RenderWithProvidersResult extends RenderResult {
  store: TestStore
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { store = createTestStore(), ...rest } = options

  function Wrapper({ children }: { children: ReactNode }) {
    return <JotaiProvider store={store}>{children}</JotaiProvider>
  }

  const result = render(ui, { wrapper: Wrapper, ...rest })
  return { ...result, store }
}
