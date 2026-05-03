import { describe, test, expect } from "vitest"
import {
  IMPLEMENT_PLAN_BASE_TEXT,
  initialPlanApprovalState,
  isInFlight,
  reducePlanApproval,
  runPlanApproval,
  type PlanApprovalState,
} from "./plan-approval-machine"

describe("initialPlanApprovalState + isInFlight", () => {
  test("starts idle", () => {
    expect(initialPlanApprovalState()).toEqual({ kind: "idle" })
  })

  test("isInFlight is false for idle / sent / error", () => {
    expect(isInFlight({ kind: "idle" })).toBe(false)
    expect(isInFlight({ kind: "sent", subChatId: "s" })).toBe(false)
    expect(isInFlight({ kind: "error", subChatId: "s", reason: "x" })).toBe(false)
  })

  test("isInFlight is true once APPROVE_REQUESTED has fired", () => {
    const next = reducePlanApproval(initialPlanApprovalState(), {
      type: "APPROVE_REQUESTED",
      subChatId: "s1",
      previousProvider: "claude-code",
    })
    expect(isInFlight(next)).toBe(true)
  })
})

describe("APPROVE_REQUESTED — captures previousProvider before any state change (PR #52)", () => {
  test("idle → starting carries subChatId + previousProvider", () => {
    const next = reducePlanApproval(initialPlanApprovalState(), {
      type: "APPROVE_REQUESTED",
      subChatId: "s1",
      previousProvider: "codex",
    })
    expect(next).toEqual({ kind: "starting", subChatId: "s1", previousProvider: "codex" })
  })

  test("re-entry on the same subChatId in starting is a no-op (single-flight lock)", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "codex" },
    ])
    if (after.kind !== "starting") throw new Error("expected starting")
    expect(after.previousProvider).toBe("claude-code")
  })

  test("APPROVE_REQUESTED ignored from non-idle states", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MODE_SWITCHED" },
      { type: "APPROVE_REQUESTED", subChatId: "s2", previousProvider: "codex" },
    ])
    if (after.kind !== "mode-switched") throw new Error("expected mode-switched")
    expect(after.subChatId).toBe("s1")
    expect(after.previousProvider).toBe("claude-code")
  })
})

describe("MODE_SWITCHED — happens before any await (PR #51)", () => {
  test("starting → mode-switched preserves subChatId + previousProvider", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MODE_SWITCHED" },
    ])
    expect(after).toEqual({
      kind: "mode-switched",
      subChatId: "s1",
      previousProvider: "claude-code",
    })
  })

  test("MODE_SWITCHED from idle is a no-op", () => {
    const after = reducePlanApproval(initialPlanApprovalState(), { type: "MODE_SWITCHED" })
    expect(after).toEqual({ kind: "idle" })
  })
})

describe("MODEL_APPLIED — same provider branch (PR #44 — keep transport)", () => {
  test("Claude→Claude jumps directly to ready-to-send with text-only payload + KEEP", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MODE_SWITCHED" },
      { type: "MODEL_APPLIED", newProvider: "claude-code" },
    ])
    if (after.kind !== "ready-to-send") throw new Error("expected ready-to-send")
    expect(after.newProvider).toBe("claude-code")
    expect(after.transportAction).toEqual({ kind: "keep" })
    expect(after.payload).toEqual({ kind: "text-only", text: IMPLEMENT_PLAN_BASE_TEXT })
  })

  test("Codex→Codex jumps directly to ready-to-send with text-only payload + KEEP", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "codex" },
      { type: "MODE_SWITCHED" },
      { type: "MODEL_APPLIED", newProvider: "codex" },
    ])
    if (after.kind !== "ready-to-send") throw new Error("expected ready-to-send")
    expect(after.transportAction).toEqual({ kind: "keep" })
    expect(after.payload.kind).toBe("text-only")
  })
})

describe("MODEL_APPLIED — cross provider branch (PR #52, #40)", () => {
  test("Claude→Codex stops at model-applied to await PLAN_CONTENT_RESOLVED", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MODE_SWITCHED" },
      { type: "MODEL_APPLIED", newProvider: "codex" },
    ])
    if (after.kind !== "model-applied") throw new Error("expected model-applied")
    expect(after.newProvider).toBe("codex")
    expect(after.previousProvider).toBe("claude-code")
    expect(after.crossProvider).toBe(true)
  })

  test("Codex→Claude stops at model-applied to await PLAN_CONTENT_RESOLVED", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "codex" },
      { type: "MODE_SWITCHED" },
      { type: "MODEL_APPLIED", newProvider: "claude-code" },
    ])
    if (after.kind !== "model-applied") throw new Error("expected model-applied")
    expect(after.crossProvider).toBe(true)
  })
})

describe("PLAN_CONTENT_RESOLVED — produces ready-to-send with attachment + RECREATE", () => {
  test("Claude→Codex with plan content → ready-to-send + with-plan-attachment + RECREATE(plan-approval-cross-provider)", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MODE_SWITCHED" },
      { type: "MODEL_APPLIED", newProvider: "codex" },
      { type: "PLAN_CONTENT_RESOLVED", planContent: "## Plan\n1. Step one" },
    ])
    if (after.kind !== "ready-to-send") throw new Error("expected ready-to-send")
    expect(after.transportAction).toMatchObject({
      kind: "recreate",
      provider: "codex",
      reason: "plan-approval-cross-provider",
    })
    if (after.payload.kind !== "with-plan-attachment") throw new Error("expected attachment")
    expect(after.payload.text).toBe(IMPLEMENT_PLAN_BASE_TEXT)
    expect(after.payload.planContent).toBe("## Plan\n1. Step one")
  })

  test("Cross-provider with null plan content still proceeds (best-effort)", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MODE_SWITCHED" },
      { type: "MODEL_APPLIED", newProvider: "codex" },
      { type: "PLAN_CONTENT_RESOLVED", planContent: null },
    ])
    if (after.kind !== "ready-to-send") throw new Error("expected ready-to-send")
    if (after.payload.kind !== "with-plan-attachment") throw new Error("expected attachment")
    expect(after.payload.planContent).toBeNull()
  })

  test("PLAN_CONTENT_RESOLVED ignored from non-(model-applied) states", () => {
    const after = reducePlanApproval(initialPlanApprovalState(), {
      type: "PLAN_CONTENT_RESOLVED",
      planContent: "x",
    })
    expect(after.kind).toBe("idle")
  })
})

describe("MESSAGE_SENT — ready-to-send → sent", () => {
  test("transitions to sent after the orchestrator confirms the send", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MODE_SWITCHED" },
      { type: "MODEL_APPLIED", newProvider: "claude-code" },
      { type: "MESSAGE_SENT" },
    ])
    expect(after).toEqual({ kind: "sent", subChatId: "s1" })
  })

  test("MESSAGE_SENT outside ready-to-send is ignored", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "MESSAGE_SENT" },
    ])
    expect(after.kind).toBe("starting")
  })
})

describe("FAIL — converts to error from any non-idle state", () => {
  test("starting + FAIL → error", () => {
    const after = runPlanApproval(initialPlanApprovalState(), [
      { type: "APPROVE_REQUESTED", subChatId: "s1", previousProvider: "claude-code" },
      { type: "FAIL", reason: "DB timeout" },
    ])
    expect(after).toEqual({ kind: "error", subChatId: "s1", reason: "DB timeout" })
  })

  test("FAIL from idle stays idle", () => {
    const after = reducePlanApproval(initialPlanApprovalState(), { type: "FAIL", reason: "x" })
    expect(after.kind).toBe("idle")
  })
})

describe("RESET — always returns to idle", () => {
  test("from any state", () => {
    const states: PlanApprovalState[] = [
      { kind: "idle" },
      { kind: "starting", subChatId: "s", previousProvider: "claude-code" },
      { kind: "sent", subChatId: "s" },
      { kind: "error", subChatId: "s", reason: "x" },
    ]
    for (const s of states) {
      expect(reducePlanApproval(s, { type: "RESET" })).toEqual({ kind: "idle" })
    }
  })
})

describe("Full happy path traces", () => {
  test("same-provider Claude approval", () => {
    const trace = [
      { type: "APPROVE_REQUESTED" as const, subChatId: "s1", previousProvider: "claude-code" as const },
      { type: "MODE_SWITCHED" as const },
      { type: "MODEL_APPLIED" as const, newProvider: "claude-code" as const },
      { type: "MESSAGE_SENT" as const },
    ]
    const after = runPlanApproval(initialPlanApprovalState(), trace)
    expect(after).toEqual({ kind: "sent", subChatId: "s1" })
  })

  test("cross-provider Claude → Codex approval (PR #52 happy path)", () => {
    const trace = [
      { type: "APPROVE_REQUESTED" as const, subChatId: "s1", previousProvider: "claude-code" as const },
      { type: "MODE_SWITCHED" as const },
      { type: "MODEL_APPLIED" as const, newProvider: "codex" as const },
      { type: "PLAN_CONTENT_RESOLVED" as const, planContent: "plan body" },
      { type: "MESSAGE_SENT" as const },
    ]
    const after = runPlanApproval(initialPlanApprovalState(), trace)
    expect(after).toEqual({ kind: "sent", subChatId: "s1" })
  })

  test("cross-provider Codex (gpt-5.5) → Claude (sonnet) approval — PR #52 specific scenario", () => {
    const trace = [
      { type: "APPROVE_REQUESTED" as const, subChatId: "s1", previousProvider: "codex" as const },
      { type: "MODE_SWITCHED" as const },
      { type: "MODEL_APPLIED" as const, newProvider: "claude-code" as const },
      { type: "PLAN_CONTENT_RESOLVED" as const, planContent: "## Plan from Codex" },
      { type: "MESSAGE_SENT" as const },
    ]
    const after = runPlanApproval(initialPlanApprovalState(), trace)
    expect(after.kind).toBe("sent")
  })
})
