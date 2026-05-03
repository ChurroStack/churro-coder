import { describe, test, expect } from "vitest"
import {
  decideTransportAction,
  decidePlanApprovalCrossProviderRecreate,
  type TransportInput,
} from "./transport-lifecycle"

const baseInput: TransportInput = {
  hasExisting: true,
  existingProvider: "claude-code",
  existingIsRemote: false,
  targetProvider: "claude-code",
  targetIsRemote: false,
  isStreaming: false,
  hasQueue: false,
  isStaleRuntime: false,
  hasMessages: true,
}

function withInput(overrides: Partial<TransportInput>): TransportInput {
  return { ...baseInput, ...overrides }
}

describe("decideTransportAction — no existing transport", () => {
  test("returns CREATE for the target provider", () => {
    const result = decideTransportAction(
      withInput({ hasExisting: false, existingProvider: null, targetProvider: "codex" }),
    )
    expect(result).toEqual({ kind: "create", provider: "codex", isRemote: false })
  })

  test("CREATE preserves the isRemote flag", () => {
    const result = decideTransportAction(
      withInput({
        hasExisting: false,
        existingProvider: null,
        targetProvider: "claude-code",
        targetIsRemote: true,
      }),
    )
    expect(result).toEqual({ kind: "create", provider: "claude-code", isRemote: true })
  })
})

describe("decideTransportAction — remote chats are pinned", () => {
  test("existing remote chat → KEEP regardless of provider mismatch", () => {
    const result = decideTransportAction(
      withInput({
        existingIsRemote: true,
        existingProvider: "claude-code",
        targetProvider: "codex",
      }),
    )
    expect(result).toEqual({ kind: "keep" })
  })

  test("existing remote chat with stale runtime → KEEP (remote rule wins)", () => {
    const result = decideTransportAction(
      withInput({ existingIsRemote: true, isStaleRuntime: true }),
    )
    expect(result).toEqual({ kind: "keep" })
  })
})

describe("decideTransportAction — stale runtime", () => {
  test("idle, no queue, stale runtime → RECREATE(stale-runtime)", () => {
    const result = decideTransportAction(withInput({ isStaleRuntime: true }))
    expect(result.kind).toBe("recreate")
    if (result.kind === "recreate") {
      expect(result.reason).toBe("stale-runtime")
      expect(result.provider).toBe("claude-code")
    }
  })

  test("streaming + stale runtime → KEEP (don't tear down active stream)", () => {
    const result = decideTransportAction(withInput({ isStaleRuntime: true, isStreaming: true }))
    expect(result).toEqual({ kind: "keep" })
  })

  test("queued + stale runtime → KEEP (don't drop queued messages)", () => {
    const result = decideTransportAction(withInput({ isStaleRuntime: true, hasQueue: true }))
    expect(result).toEqual({ kind: "keep" })
  })
})

describe("decideTransportAction — provider matches", () => {
  test("same provider → KEEP", () => {
    const result = decideTransportAction(
      withInput({ existingProvider: "claude-code", targetProvider: "claude-code" }),
    )
    expect(result).toEqual({ kind: "keep" })
  })

  test("same provider (codex) → KEEP", () => {
    const result = decideTransportAction(
      withInput({ existingProvider: "codex", targetProvider: "codex" }),
    )
    expect(result).toEqual({ kind: "keep" })
  })
})

describe("decideTransportAction — cross-provider (PR #44 regression)", () => {
  test("cross-provider with messages → KEEP (preserve in-flight tool events)", () => {
    const result = decideTransportAction(
      withInput({
        existingProvider: "claude-code",
        targetProvider: "codex",
        hasMessages: true,
      }),
    )
    expect(result).toEqual({ kind: "keep" })
  })

  test("cross-provider with no messages → RECREATE(cross-provider-empty)", () => {
    const result = decideTransportAction(
      withInput({
        existingProvider: "claude-code",
        targetProvider: "codex",
        hasMessages: false,
      }),
    )
    expect(result.kind).toBe("recreate")
    if (result.kind === "recreate") {
      expect(result.reason).toBe("cross-provider-empty")
      expect(result.provider).toBe("codex")
    }
  })
})

describe("decideTransportAction — rule precedence", () => {
  test("hasExisting=false short-circuits all other rules", () => {
    const result = decideTransportAction(
      withInput({
        hasExisting: false,
        existingProvider: null,
        existingIsRemote: true,
        isStaleRuntime: true,
        isStreaming: true,
        hasQueue: true,
        hasMessages: true,
      }),
    )
    expect(result.kind).toBe("create")
  })

  test("remote rule wins over stale-runtime", () => {
    const result = decideTransportAction(
      withInput({ existingIsRemote: true, isStaleRuntime: true }),
    )
    expect(result.kind).toBe("keep")
  })

  test("stale-runtime wins over provider-match", () => {
    const result = decideTransportAction(
      withInput({
        isStaleRuntime: true,
        existingProvider: "claude-code",
        targetProvider: "claude-code",
      }),
    )
    expect(result.kind).toBe("recreate")
  })

  test("provider-match wins over hasMessages branch", () => {
    const result = decideTransportAction(
      withInput({
        existingProvider: "codex",
        targetProvider: "codex",
        hasMessages: false,
      }),
    )
    expect(result.kind).toBe("keep")
  })
})

describe("decidePlanApprovalCrossProviderRecreate", () => {
  test("same provider → KEEP (PR #44 regression — don't orphan in-flight events)", () => {
    expect(
      decidePlanApprovalCrossProviderRecreate({
        previousProvider: "claude-code",
        newProvider: "claude-code",
        newIsRemote: false,
      }),
    ).toEqual({ kind: "keep" })
  })

  test("Claude → Codex → RECREATE(plan-approval-cross-provider) (PR #52 path)", () => {
    const result = decidePlanApprovalCrossProviderRecreate({
      previousProvider: "claude-code",
      newProvider: "codex",
      newIsRemote: false,
    })
    expect(result).toEqual({
      kind: "recreate",
      provider: "codex",
      isRemote: false,
      reason: "plan-approval-cross-provider",
    })
  })

  test("Codex → Claude → RECREATE", () => {
    const result = decidePlanApprovalCrossProviderRecreate({
      previousProvider: "codex",
      newProvider: "claude-code",
      newIsRemote: false,
    })
    expect(result.kind).toBe("recreate")
    if (result.kind === "recreate") {
      expect(result.provider).toBe("claude-code")
    }
  })

  test("preserves isRemote flag", () => {
    const result = decidePlanApprovalCrossProviderRecreate({
      previousProvider: "claude-code",
      newProvider: "codex",
      newIsRemote: true,
    })
    if (result.kind !== "recreate") throw new Error("expected recreate")
    expect(result.isRemote).toBe(true)
  })
})
