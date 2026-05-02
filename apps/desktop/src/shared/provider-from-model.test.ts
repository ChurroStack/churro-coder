import { describe, test, expect } from "vitest"
import { getProviderForModelId } from "./provider-from-model"

describe("getProviderForModelId", () => {
  test("null → claude-code default", () => {
    expect(getProviderForModelId(null)).toBe("claude-code")
  })

  test("undefined → claude-code default", () => {
    expect(getProviderForModelId(undefined)).toBe("claude-code")
  })

  test("empty string → claude-code default", () => {
    expect(getProviderForModelId("")).toBe("claude-code")
  })

  test.each(["opus", "opus[1m]", "sonnet", "sonnet[1m]", "haiku"])(
    "Claude model '%s' → claude-code",
    (id) => {
      expect(getProviderForModelId(id)).toBe("claude-code")
    },
  )

  test.each([
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
  ])("Codex model '%s' → codex", (id) => {
    expect(getProviderForModelId(id)).toBe("codex")
  })

  test("unknown id starting with gpt- → codex (heuristic)", () => {
    expect(getProviderForModelId("gpt-99-future")).toBe("codex")
  })

  test("unknown id containing 'codex' → codex (heuristic)", () => {
    expect(getProviderForModelId("some-codex-model")).toBe("codex")
  })

  test("unknown id without codex/gpt prefix → claude-code (heuristic)", () => {
    expect(getProviderForModelId("completely-unknown-model")).toBe("claude-code")
  })

  test("Codex UI id 'gpt-5.4/high' (with thinking suffix) → codex", () => {
    // The suffix is stripped by the heuristic: starts with gpt-
    expect(getProviderForModelId("gpt-5.4/high")).toBe("codex")
  })
})
