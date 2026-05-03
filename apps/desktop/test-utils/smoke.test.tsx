// @vitest-environment jsdom
import { describe, test, expect, afterEach } from "vitest"
import { atom, useAtom } from "jotai"
import { cleanup } from "@testing-library/react"
import { renderWithProviders } from "./render-with-providers"
import { createTestStore } from "./create-test-store"
import { createMockTransport } from "./create-mock-transport"

afterEach(() => {
  cleanup()
})

// Smoke test for the test-utils wiring. If this passes, downstream component
// tests can rely on:
//   - jsdom env via the per-file pragma above
//   - @testing-library/react rendering through a fresh isolated jotai store
//   - vitest-mocked transports

const counterAtom = atom(0)

function Counter() {
  const [count, setCount] = useAtom(counterAtom)
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      count: {count}
    </button>
  )
}

describe("test-utils smoke", () => {
  test("renderWithProviders mounts a component with an isolated jotai store", () => {
    const { getByRole, store } = renderWithProviders(<Counter />)
    const button = getByRole("button")
    expect(button.textContent).toBe("count: 0")
    expect(store.get(counterAtom)).toBe(0)
  })

  test("a fresh store starts at the atom default", () => {
    const { getByRole } = renderWithProviders(<Counter />)
    expect(getByRole("button").textContent).toBe("count: 0")
  })

  test("a passed-in store seeds the rendered component", () => {
    const sharedStore = createTestStore()
    sharedStore.set(counterAtom, 42)
    const { getByRole } = renderWithProviders(<Counter />, { store: sharedStore })
    expect(getByRole("button").textContent).toBe("count: 42")
  })

  test("createMockTransport records sendMessages calls and exposes provider", async () => {
    const transport = createMockTransport({
      chatId: "c1",
      subChatId: "s1",
      provider: "codex",
    })
    expect(transport.provider).toBe("codex")
    expect(transport.sendCount).toBe(0)
    await transport.sendMessages({ messages: [{ id: "m1", role: "user" }] })
    expect(transport.sendCount).toBe(1)
    expect(transport.sendMessages).toHaveBeenCalledTimes(1)
    expect(transport.lastSendArgs).toEqual({ messages: [{ id: "m1", role: "user" }] })
  })
})
