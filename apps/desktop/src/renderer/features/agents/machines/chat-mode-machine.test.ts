import { describe, test, expect } from "vitest"
import {
  initialChatModeState,
  reduceChatMode,
  runChatMode,
  type ChatModeState,
} from "./chat-mode-machine"

describe("initialChatModeState", () => {
  test("defaults to agent mode + idle", () => {
    expect(initialChatModeState()).toEqual({
      mode: "agent",
      activity: "idle",
      hydrationVersion: 0,
      mustApplyDefaults: false,
    })
  })

  test("accepts an explicit initial mode", () => {
    expect(initialChatModeState("plan").mode).toBe("plan")
  })
})

describe("USER_TOGGLED_MODE — happy path (PR #38: chip reflects atom immediately)", () => {
  test("idle → toggle to plan flips mode + sets mustApplyDefaults", () => {
    const next = reduceChatMode(initialChatModeState("agent"), {
      type: "USER_TOGGLED_MODE",
      to: "plan",
    })
    expect(next.mode).toBe("plan")
    expect(next.mustApplyDefaults).toBe(true)
    expect(next.hydrationVersion).toBe(1)
  })

  test("toggling to the same mode is a no-op (no spurious mustApplyDefaults)", () => {
    const next = reduceChatMode(initialChatModeState("agent"), {
      type: "USER_TOGGLED_MODE",
      to: "agent",
    })
    expect(next.mode).toBe("agent")
    expect(next.mustApplyDefaults).toBe(false)
    expect(next.hydrationVersion).toBe(0)
  })

  test("toggle is rejected while sending (prevents PR #36 race)", () => {
    const sending = reduceChatMode(initialChatModeState("agent"), { type: "SEND_REQUESTED" })
    expect(sending.activity).toBe("sending")
    const attempted = reduceChatMode(sending, { type: "USER_TOGGLED_MODE", to: "plan" })
    expect(attempted.mode).toBe("agent")
    expect(attempted.activity).toBe("sending")
  })

  test("toggle is rejected while streaming", () => {
    const streaming = runChatMode(initialChatModeState("agent"), [
      { type: "SEND_REQUESTED" },
      { type: "STREAM_STARTED" },
    ])
    const attempted = reduceChatMode(streaming, { type: "USER_TOGGLED_MODE", to: "plan" })
    expect(attempted.mode).toBe("agent")
  })
})

describe("FORCE_MODE — plan approval auto-flip", () => {
  test("plan → agent via FORCE_MODE wins even mid-stream", () => {
    const streaming = runChatMode(initialChatModeState("plan"), [
      { type: "SEND_REQUESTED" },
      { type: "STREAM_STARTED" },
    ])
    const next = reduceChatMode(streaming, { type: "FORCE_MODE", to: "agent", reason: "plan-approved" })
    expect(next.mode).toBe("agent")
    expect(next.activity).toBe("streaming")
    expect(next.mustApplyDefaults).toBe(true)
    expect(next.hydrationVersion).toBe(streaming.hydrationVersion + 1)
  })

  test("FORCE_MODE to same target still bumps hydrationVersion (so stale HYDRATE can't revert)", () => {
    const next = reduceChatMode(initialChatModeState("plan"), {
      type: "FORCE_MODE",
      to: "plan",
      reason: "plan-approved",
    })
    expect(next.mode).toBe("plan")
    expect(next.hydrationVersion).toBe(1)
    expect(next.mustApplyDefaults).toBe(false)
  })
})

describe("HYDRATE — stale refetch race (PR #51 regression)", () => {
  test("HYDRATE with newer version sets mode", () => {
    const next = reduceChatMode(initialChatModeState("agent"), {
      type: "HYDRATE",
      from: "plan",
      hydrationVersion: 5,
    })
    expect(next.mode).toBe("plan")
    expect(next.hydrationVersion).toBe(5)
    expect(next.mustApplyDefaults).toBe(true)
  })

  test("HYDRATE with stale version is rejected — does NOT clobber a forced flip", () => {
    // Simulate the bug scenario:
    //   1. user is in plan mode (hydrationVersion=0)
    //   2. plan approved → FORCE_MODE to agent (hydrationVersion=1)
    //   3. stale getAgentChat refetch arrives carrying mode=plan with hydrationVersion=0
    const afterApproval = reduceChatMode(initialChatModeState("plan"), {
      type: "FORCE_MODE",
      to: "agent",
      reason: "plan-approved",
    })
    expect(afterApproval.mode).toBe("agent")
    expect(afterApproval.hydrationVersion).toBe(1)

    const afterStaleHydrate = reduceChatMode(afterApproval, {
      type: "HYDRATE",
      from: "plan",
      hydrationVersion: 0,
    })
    expect(afterStaleHydrate.mode).toBe("agent")
    expect(afterStaleHydrate.hydrationVersion).toBe(1)
  })

  test("HYDRATE matching current mode just records the version", () => {
    const next = reduceChatMode(initialChatModeState("agent"), {
      type: "HYDRATE",
      from: "agent",
      hydrationVersion: 3,
    })
    expect(next.mode).toBe("agent")
    expect(next.hydrationVersion).toBe(3)
    expect(next.mustApplyDefaults).toBe(false)
  })
})

describe("activity transitions", () => {
  test("SEND_REQUESTED from idle → sending", () => {
    expect(reduceChatMode(initialChatModeState(), { type: "SEND_REQUESTED" }).activity).toBe(
      "sending",
    )
  })

  test("SEND_REQUESTED from sending is a no-op", () => {
    const sending: ChatModeState = {
      ...initialChatModeState(),
      activity: "sending",
    }
    expect(reduceChatMode(sending, { type: "SEND_REQUESTED" }).activity).toBe("sending")
  })

  test("STREAM_STARTED → streaming (even from idle, server-initiated)", () => {
    expect(reduceChatMode(initialChatModeState(), { type: "STREAM_STARTED" }).activity).toBe(
      "streaming",
    )
  })

  test("STREAM_COMPLETED → idle", () => {
    const streaming = runChatMode(initialChatModeState(), [
      { type: "SEND_REQUESTED" },
      { type: "STREAM_STARTED" },
    ])
    expect(reduceChatMode(streaming, { type: "STREAM_COMPLETED" }).activity).toBe("idle")
  })

  test("STREAM_ERRORED → errored", () => {
    const streaming = runChatMode(initialChatModeState(), [{ type: "STREAM_STARTED" }])
    expect(reduceChatMode(streaming, { type: "STREAM_ERRORED" }).activity).toBe("errored")
  })

  test("ERROR_CLEARED returns errored → idle", () => {
    const errored = runChatMode(initialChatModeState(), [
      { type: "STREAM_STARTED" },
      { type: "STREAM_ERRORED" },
    ])
    expect(reduceChatMode(errored, { type: "ERROR_CLEARED" }).activity).toBe("idle")
  })

  test("ERROR_CLEARED from idle is a no-op", () => {
    const next = reduceChatMode(initialChatModeState(), { type: "ERROR_CLEARED" })
    expect(next.activity).toBe("idle")
  })

  test("CANCEL_REQUESTED from streaming → idle", () => {
    const streaming = runChatMode(initialChatModeState(), [{ type: "STREAM_STARTED" }])
    expect(reduceChatMode(streaming, { type: "CANCEL_REQUESTED" }).activity).toBe("idle")
  })

  test("CANCEL_REQUESTED from idle is a no-op", () => {
    expect(reduceChatMode(initialChatModeState(), { type: "CANCEL_REQUESTED" }).activity).toBe(
      "idle",
    )
  })
})

describe("mustApplyDefaults — one-shot semantics", () => {
  test("set on toggle, cleared by next non-mode event", () => {
    const after1 = reduceChatMode(initialChatModeState(), {
      type: "USER_TOGGLED_MODE",
      to: "plan",
    })
    expect(after1.mustApplyDefaults).toBe(true)
    const after2 = reduceChatMode(after1, { type: "SEND_REQUESTED" })
    expect(after2.mustApplyDefaults).toBe(false)
  })

  test("set on FORCE_MODE that changes the mode, cleared on next event", () => {
    const after1 = reduceChatMode(initialChatModeState("plan"), {
      type: "FORCE_MODE",
      to: "agent",
      reason: "plan-approved",
    })
    expect(after1.mustApplyDefaults).toBe(true)
    const after2 = reduceChatMode(after1, { type: "STREAM_STARTED" })
    expect(after2.mustApplyDefaults).toBe(false)
  })
})

describe("runChatMode — full flow", () => {
  test("plan → user sends → assistant streams → completes → user toggles to agent", () => {
    const state = runChatMode(initialChatModeState("plan"), [
      { type: "SEND_REQUESTED" },
      { type: "STREAM_STARTED" },
      { type: "STREAM_COMPLETED" },
      { type: "USER_TOGGLED_MODE", to: "agent" },
    ])
    expect(state.mode).toBe("agent")
    expect(state.activity).toBe("idle")
    expect(state.mustApplyDefaults).toBe(true)
    expect(state.hydrationVersion).toBe(1)
  })

  test("plan approval flow: stream → complete → force agent → send → stream", () => {
    const state = runChatMode(initialChatModeState("plan"), [
      { type: "SEND_REQUESTED" },
      { type: "STREAM_STARTED" },
      { type: "STREAM_COMPLETED" },
      { type: "FORCE_MODE", to: "agent", reason: "plan-approved" },
      { type: "SEND_REQUESTED" },
      { type: "STREAM_STARTED" },
    ])
    expect(state.mode).toBe("agent")
    expect(state.activity).toBe("streaming")
    expect(state.hydrationVersion).toBe(1)
  })
})
