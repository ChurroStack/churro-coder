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

type ElectronTRPCMessageHandler = (args: unknown) => void

const electronTRPC = {
  sendMessage: (_args: unknown) => {},
  onMessage: (_callback: ElectronTRPCMessageHandler) => {}
}

Object.defineProperty(globalThis, "electronTRPC", {
  value: electronTRPC,
  writable: true,
})

// jsdom doesn't implement ResizeObserver. Components that mount
// react-resizable-panels (ResizablePanelGroup) reference it at mount, so install
// a no-op stub globally instead of per-test. Guarded so a real implementation
// (if a future environment provides one) is never clobbered.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
}
