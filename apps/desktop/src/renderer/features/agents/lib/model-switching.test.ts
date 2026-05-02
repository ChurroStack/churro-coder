import { describe, test, expect, beforeEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// atoms/index.ts uses atomWithWindowStorage which accesses window.localStorage during init.
// Mock window-storage to use plain atoms so the test runs in a node environment.
vi.mock("../../../lib/window-storage", async () => {
  const { atom } = await import("jotai")
  return {
    atomWithWindowStorage: (_key: string, defaultValue: unknown) => atom(defaultValue),
    createWindowScopedStorage: () => ({
      getItem: (_key: string, init: unknown) => init,
      setItem: () => {},
      removeItem: () => {},
    }),
  }
})
import { appStore } from "../../../lib/jotai-store"
import {
  defaultPlanModeModelAtom,
  defaultAgentModeModelAtom,
  defaultReviewModeModelAtom,
  defaultPlanModeThinkingAtom,
  defaultAgentModeThinkingAtom,
  defaultReviewModeThinkingAtom,
  subChatModelIdAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatClaudeThinkingAtomFamily,
  subChatCodexThinkingAtomFamily,
  subChatProviderOverrideAtomFamily,
  lastSelectedClaudeThinkingAtom,
  lastSelectedCodexThinkingAtom,
} from "../atoms"
import {
  applyModeDefaultModel,
  getDefaultModelForMode,
  getDefaultThinkingForMode,
} from "./model-switching"

let testCounter = 0
function nextSubChatId(): string {
  return `test-sub-${++testCounter}`
}

beforeEach(() => {
  appStore.set(defaultPlanModeModelAtom, "opus[1m]")
  appStore.set(defaultAgentModeModelAtom, "sonnet")
  appStore.set(defaultReviewModeModelAtom, "opus")
  appStore.set(defaultPlanModeThinkingAtom, "high")
  appStore.set(defaultAgentModeThinkingAtom, "high")
  appStore.set(defaultReviewModeThinkingAtom, "high")
})

describe("getDefaultModelForMode", () => {
  test("plan → reads defaultPlanModeModelAtom", () => {
    appStore.set(defaultPlanModeModelAtom, "opus[1m]")
    expect(getDefaultModelForMode("plan")).toBe("opus[1m]")
  })

  test("agent → reads defaultAgentModeModelAtom", () => {
    appStore.set(defaultAgentModeModelAtom, "haiku")
    expect(getDefaultModelForMode("agent")).toBe("haiku")
  })

  test("review → reads defaultReviewModeModelAtom", () => {
    appStore.set(defaultReviewModeModelAtom, "sonnet")
    expect(getDefaultModelForMode("review")).toBe("sonnet")
  })
})

describe("getDefaultThinkingForMode", () => {
  test("plan → reads defaultPlanModeThinkingAtom", () => {
    appStore.set(defaultPlanModeThinkingAtom, "xhigh")
    expect(getDefaultThinkingForMode("plan")).toBe("xhigh")
  })

  test("agent → reads defaultAgentModeThinkingAtom", () => {
    appStore.set(defaultAgentModeThinkingAtom, "off")
    expect(getDefaultThinkingForMode("agent")).toBe("off")
  })

  test("review → reads defaultReviewModeThinkingAtom", () => {
    appStore.set(defaultReviewModeThinkingAtom, "low")
    expect(getDefaultThinkingForMode("review")).toBe("low")
  })
})

describe("applyModeDefaultModel — Claude path", () => {
  test("review with Claude model → sets Claude atoms, provider = claude-code", () => {
    const id = nextSubChatId()
    appStore.set(defaultReviewModeModelAtom, "opus")
    appStore.set(defaultReviewModeThinkingAtom, "high")

    const result = applyModeDefaultModel(id, "review")

    expect(result.modelId).toBe("opus")
    expect(result.provider).toBe("claude-code")
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe("opus")
    expect(appStore.get(subChatClaudeThinkingAtomFamily(id))).toBe("high")
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe("claude-code")
    expect(appStore.get(lastSelectedClaudeThinkingAtom)).toBe("high")
  })

  test("review with Claude model → codex atoms not updated for this subChatId", () => {
    const id = nextSubChatId()
    appStore.set(defaultReviewModeModelAtom, "opus")
    // Codex atoms still at their defaults
    const codexModelBefore = appStore.get(subChatCodexModelIdAtomFamily(id))

    applyModeDefaultModel(id, "review")

    // Codex model for this subChatId is unchanged (still the fallback default)
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe(codexModelBefore)
  })

  test("plan with Claude model → subChatModelId set to plan model", () => {
    const id = nextSubChatId()
    appStore.set(defaultPlanModeModelAtom, "opus[1m]")
    appStore.set(defaultPlanModeThinkingAtom, "xhigh")

    const result = applyModeDefaultModel(id, "plan")

    expect(result.modelId).toBe("opus[1m]")
    expect(result.provider).toBe("claude-code")
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe("opus[1m]")
    expect(appStore.get(subChatClaudeThinkingAtomFamily(id))).toBe("xhigh")
  })
})

describe("applyModeDefaultModel — Codex path (#32 regression)", () => {
  test("review with Codex model → sets Codex atoms, provider = codex", () => {
    const id = nextSubChatId()
    appStore.set(defaultReviewModeModelAtom, "gpt-5.3-codex")
    appStore.set(defaultReviewModeThinkingAtom, "high")

    const result = applyModeDefaultModel(id, "review")

    expect(result.modelId).toBe("gpt-5.3-codex")
    expect(result.provider).toBe("codex")
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe("gpt-5.3-codex")
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe("high")
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe("codex")
    expect(appStore.get(lastSelectedCodexThinkingAtom)).toBe("high")
  })

  test("review with Codex model → Claude model atom NOT set to the Codex model ID", () => {
    const id = nextSubChatId()
    appStore.set(defaultReviewModeModelAtom, "gpt-5.3-codex")

    applyModeDefaultModel(id, "review")

    // The Claude model atom should NOT have been set to the Codex model ID
    expect(appStore.get(subChatModelIdAtomFamily(id))).not.toBe("gpt-5.3-codex")
  })

  test("Codex thinking coerced when model doesn't support the requested level", () => {
    const id = nextSubChatId()
    // gpt-5.3-codex-spark only supports ["low","medium","high"] (no xhigh)
    appStore.set(defaultReviewModeModelAtom, "gpt-5.3-codex-spark")
    appStore.set(defaultReviewModeThinkingAtom, "xhigh")

    applyModeDefaultModel(id, "review")

    // "xhigh" not in ["low","medium","high"] → coerced to "high"
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe("high")
  })

  test("Codex thinking 'max' treated as 'xhigh' → stays xhigh when supported", () => {
    const id = nextSubChatId()
    // gpt-5.3-codex supports ["low","medium","high","xhigh"]
    appStore.set(defaultReviewModeModelAtom, "gpt-5.3-codex")
    appStore.set(defaultReviewModeThinkingAtom, "max")

    applyModeDefaultModel(id, "review")

    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe("xhigh")
  })

  test("Codex thinking 'max' coerced when model doesn't support xhigh", () => {
    const id = nextSubChatId()
    // gpt-5.4-mini only supports ["low","medium","high"]
    appStore.set(defaultReviewModeModelAtom, "gpt-5.4-mini")
    appStore.set(defaultReviewModeThinkingAtom, "max")

    applyModeDefaultModel(id, "review")

    // max → xhigh → not in ["low","medium","high"] → falls back to "high"
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe("high")
  })

  test("lastSelectedCodexThinkingAtom updated, lastSelectedClaudeThinkingAtom unchanged", () => {
    const id = nextSubChatId()
    appStore.set(defaultReviewModeModelAtom, "gpt-5.3-codex")
    appStore.set(defaultReviewModeThinkingAtom, "high")
    appStore.set(lastSelectedClaudeThinkingAtom, "off")

    applyModeDefaultModel(id, "review")

    expect(appStore.get(lastSelectedCodexThinkingAtom)).toBe("high")
    expect(appStore.get(lastSelectedClaudeThinkingAtom)).toBe("off")
  })
})

describe("applyModeDefaultModel — agent mode", () => {
  test("agent with Claude model → sets Claude atoms, provider = claude-code", () => {
    const id = nextSubChatId()
    appStore.set(defaultAgentModeModelAtom, "haiku")
    appStore.set(defaultAgentModeThinkingAtom, "off")

    const result = applyModeDefaultModel(id, "agent")

    expect(result.modelId).toBe("haiku")
    expect(result.provider).toBe("claude-code")
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe("haiku")
    expect(appStore.get(subChatClaudeThinkingAtomFamily(id))).toBe("off")
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe("claude-code")
  })

  test("agent with Codex model → sets Codex atoms, provider = codex", () => {
    const id = nextSubChatId()
    appStore.set(defaultAgentModeModelAtom, "gpt-5.4")
    appStore.set(defaultAgentModeThinkingAtom, "medium")

    const result = applyModeDefaultModel(id, "agent")

    expect(result.modelId).toBe("gpt-5.4")
    expect(result.provider).toBe("codex")
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe("gpt-5.4")
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe("medium")
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe("codex")
  })

  test("agent with Codex model → Claude model atom NOT set to the Codex model ID", () => {
    const id = nextSubChatId()
    appStore.set(defaultAgentModeModelAtom, "gpt-5.4")

    applyModeDefaultModel(id, "agent")

    expect(appStore.get(subChatModelIdAtomFamily(id))).not.toBe("gpt-5.4")
  })

  test("plan=Claude then agent=Codex → provider override switches to codex", () => {
    const id = nextSubChatId()
    appStore.set(defaultPlanModeModelAtom, "opus[1m]")
    appStore.set(defaultAgentModeModelAtom, "gpt-5.4")

    applyModeDefaultModel(id, "plan")
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe("claude-code")

    applyModeDefaultModel(id, "agent")
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe("codex")
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe("gpt-5.4")
    // Claude model atom retains the plan-phase value, not the Codex ID
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe("opus[1m]")
  })
})

describe("applyModeDefaultModel — return value", () => {
  test("returns { modelId, provider } synchronously", () => {
    const id = nextSubChatId()
    appStore.set(defaultAgentModeModelAtom, "sonnet")
    appStore.set(defaultAgentModeThinkingAtom, "high")

    const result = applyModeDefaultModel(id, "agent")

    expect(result).toEqual({ modelId: "sonnet", provider: "claude-code" })
  })

  test("returns codex provider when model is a Codex model", () => {
    const id = nextSubChatId()
    appStore.set(defaultAgentModeModelAtom, "gpt-5.4")

    const result = applyModeDefaultModel(id, "agent")

    expect(result).toEqual({ modelId: "gpt-5.4", provider: "codex" })
  })
})

// Source-inspection guard for the AGENTS.md "Model-switch ordering" invariant.
// The unit tests above prove applyModeDefaultModel does the right thing when
// called — but they cannot catch a regression that simply moves the call back
// after the await in handleApprovePlan. This test reads active-chat.tsx and
// asserts that applyModeDefaultModel + onProviderChange both appear before any
// `await` inside handleApprovePlan's body.
describe("handleApprovePlan — call-ordering regression", () => {
  test("applyModeDefaultModel + onProviderChange precede await in handleApprovePlan", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const activeChatPath = resolve(here, "../main/active-chat.tsx")
    const src = readFileSync(activeChatPath, "utf-8")

    const fnStart = src.indexOf(
      "const handleApprovePlan = useCallback(async",
    )
    expect(fnStart, "handleApprovePlan callback not found in active-chat.tsx").toBeGreaterThan(-1)

    // useCallback closes with `}, [` followed by the dependency array. The
    // first occurrence after fnStart is unambiguous: handleApprovePlan does
    // not contain that token in its body.
    const fnEnd = src.indexOf("}, [", fnStart)
    expect(fnEnd, "handleApprovePlan closing not found").toBeGreaterThan(fnStart)
    const body = src.slice(fnStart, fnEnd)

    const applyAt = body.indexOf('applyModeDefaultModel(subChatId, "agent")')
    const providerAt = body.indexOf("onProviderChange?.(subChatId, provider)")
    const awaitAt = body.indexOf("await resolveApprovedPlanContent")

    expect(applyAt, "applyModeDefaultModel(subChatId, \"agent\") call missing").toBeGreaterThanOrEqual(0)
    expect(providerAt, "onProviderChange?.(subChatId, provider) call missing").toBeGreaterThanOrEqual(0)
    expect(awaitAt, "await resolveApprovedPlanContent call missing").toBeGreaterThanOrEqual(0)

    expect(
      applyAt < awaitAt,
      "applyModeDefaultModel must run synchronously before await — AGENTS.md model-switch ordering invariant",
    ).toBe(true)
    expect(
      providerAt < awaitAt,
      "onProviderChange must fire before await so transport recreates with the new provider before the message is sent",
    ).toBe(true)
  })
})
