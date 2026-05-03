import { createStore } from "jotai"

export type TestStore = ReturnType<typeof createStore>

export function createTestStore(): TestStore {
  return createStore()
}
