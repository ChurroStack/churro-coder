import { describe, expect, test } from "vitest"
import { shouldForceFreshSessionOnModeChange } from "./claude-mode-change"

describe("shouldForceFreshSessionOnModeChange", () => {
  test("plan→agent with active session forces fresh (the bug case)", () => {
    expect(
      shouldForceFreshSessionOnModeChange({
        resumeSessionId: "sess-1",
        existingSessionId: "sess-1",
        existingSessionMode: "plan",
        inputMode: "agent",
      }),
    ).toBe(true)
  })

  test("agent→plan with active session forces fresh (symmetric case)", () => {
    expect(
      shouldForceFreshSessionOnModeChange({
        resumeSessionId: "sess-1",
        existingSessionId: "sess-1",
        existingSessionMode: "agent",
        inputMode: "plan",
      }),
    ).toBe(true)
  })

  test("same mode does not force fresh (normal multi-turn)", () => {
    expect(
      shouldForceFreshSessionOnModeChange({
        resumeSessionId: "sess-1",
        existingSessionId: "sess-1",
        existingSessionMode: "agent",
        inputMode: "agent",
      }),
    ).toBe(false)
  })

  test("plan→plan does not force fresh", () => {
    expect(
      shouldForceFreshSessionOnModeChange({
        resumeSessionId: "sess-1",
        existingSessionId: "sess-1",
        existingSessionMode: "plan",
        inputMode: "plan",
      }),
    ).toBe(false)
  })

  test("no session to resume does not force fresh (already fresh)", () => {
    expect(
      shouldForceFreshSessionOnModeChange({
        resumeSessionId: undefined,
        existingSessionId: null,
        existingSessionMode: "plan",
        inputMode: "agent",
      }),
    ).toBe(false)
  })

  test("null sessionMode with valid DB session (legacy row) does not force fresh", () => {
    expect(
      shouldForceFreshSessionOnModeChange({
        resumeSessionId: "sess-1",
        existingSessionId: "sess-1",
        existingSessionMode: null,
        inputMode: "agent",
      }),
    ).toBe(false)
  })

  test("client has session but DB cleared it (plan approval) forces fresh", () => {
    expect(
      shouldForceFreshSessionOnModeChange({
        resumeSessionId: "plan-sess",
        existingSessionId: null,
        existingSessionMode: null,
        inputMode: "agent",
      }),
    ).toBe(true)
  })
})
