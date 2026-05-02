const store: Record<string, string> = {}
const localStorage: Storage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value
  },
  removeItem: (key: string) => {
    delete store[key]
  },
  clear: () => {
    for (const k in store) delete store[k]
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
  get length() {
    return Object.keys(store).length
  },
}

Object.defineProperty(global, "localStorage", {
  value: localStorage,
  writable: true,
})
