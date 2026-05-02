import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { autoRenameAgentChat } from "./auto-rename"

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function makeParams(overrides: Partial<Parameters<typeof autoRenameAgentChat>[0]> = {}) {
  return {
    subChatId: "sub-1",
    parentChatId: "chat-1",
    userMessage: "Build a feature",
    isFirstSubChat: true,
    generateName: vi.fn().mockResolvedValue({ name: "My Feature" }),
    renameSubChat: vi.fn().mockResolvedValue(undefined),
    renameChat: vi.fn().mockResolvedValue(undefined),
    updateSubChatName: vi.fn(),
    updateChatName: vi.fn(),
    ...overrides,
  }
}

describe("autoRenameAgentChat", () => {
  test("generic name 'New Chat' → skips renaming", async () => {
    const params = makeParams({
      generateName: vi.fn().mockResolvedValue({ name: "New Chat" }),
    })
    await autoRenameAgentChat(params)
    expect(params.renameSubChat).not.toHaveBeenCalled()
    expect(params.updateSubChatName).not.toHaveBeenCalled()
  })

  test("success on first attempt → renameSubChat and updateSubChatName called once", async () => {
    const params = makeParams()
    await autoRenameAgentChat(params)
    expect(params.renameSubChat).toHaveBeenCalledTimes(1)
    expect(params.renameSubChat).toHaveBeenCalledWith({ subChatId: "sub-1", name: "My Feature" })
    expect(params.updateSubChatName).toHaveBeenCalledWith("sub-1", "My Feature")
  })

  test("isFirstSubChat: true → renames parent chat too", async () => {
    const params = makeParams({ isFirstSubChat: true })
    await autoRenameAgentChat(params)
    expect(params.renameChat).toHaveBeenCalledWith({ chatId: "chat-1", name: "My Feature" })
    expect(params.updateChatName).toHaveBeenCalledWith("chat-1", "My Feature")
  })

  test("isFirstSubChat: false → does NOT rename parent chat", async () => {
    const params = makeParams({ isFirstSubChat: false })
    await autoRenameAgentChat(params)
    expect(params.renameChat).not.toHaveBeenCalled()
    expect(params.updateChatName).not.toHaveBeenCalled()
  })

  test("two failures then success → 3 rename attempts total", async () => {
    vi.useFakeTimers()
    const params = makeParams({
      renameSubChat: vi
        .fn()
        .mockRejectedValueOnce(new Error("not found"))
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce(undefined),
    })
    const promise = autoRenameAgentChat(params)
    // attempt 0: no sleep (runs as microtasks), fails
    await vi.advanceTimersByTimeAsync(0)
    // attempt 1: after 3000ms sleep
    await vi.advanceTimersByTimeAsync(3000)
    // attempt 2: after 5000ms sleep
    await vi.advanceTimersByTimeAsync(5000)
    await promise
    expect(params.renameSubChat).toHaveBeenCalledTimes(3)
    expect(params.updateSubChatName).toHaveBeenCalledWith("sub-1", "My Feature")
  })

  test("all four attempts fail → swallows error, no throw", async () => {
    vi.useFakeTimers()
    const params = makeParams({
      renameSubChat: vi.fn().mockRejectedValue(new Error("persistent failure")),
    })
    const promise = autoRenameAgentChat(params)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(promise).resolves.toBeUndefined()
    expect(params.renameSubChat).toHaveBeenCalledTimes(4)
    expect(params.updateSubChatName).not.toHaveBeenCalled()
  })

  test("generateName throws → swallows error", async () => {
    const params = makeParams({
      generateName: vi.fn().mockRejectedValue(new Error("LLM down")),
    })
    await expect(autoRenameAgentChat(params)).resolves.toBeUndefined()
    expect(params.renameSubChat).not.toHaveBeenCalled()
  })
})
