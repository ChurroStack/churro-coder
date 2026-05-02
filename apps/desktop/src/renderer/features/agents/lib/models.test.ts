import { describe, test, expect } from "vitest"
import {
  coerceCodexThinking,
  formatModelLabel,
  formatClaudeThinkingLabel,
} from "./models"

describe("coerceCodexThinking", () => {
  test("max → xhigh when xhigh is supported", () => {
    expect(coerceCodexThinking("max", ["low", "medium", "high", "xhigh"])).toBe("xhigh")
  })

  test("off → low when low is supported", () => {
    expect(coerceCodexThinking("off", ["low", "medium", "high"])).toBe("low")
  })

  test("off when low not supported → falls through to high", () => {
    expect(coerceCodexThinking("off", ["medium", "high"])).toBe("high")
  })

  test("preferred level supported → returned as-is", () => {
    expect(coerceCodexThinking("medium", ["low", "medium", "high"])).toBe("medium")
  })

  test("xhigh preferred but not in supported → falls back to high", () => {
    expect(coerceCodexThinking("xhigh", ["low", "medium", "high"])).toBe("high")
  })

  test("xhigh preferred, high not in supported → returns first supported (low)", () => {
    // xhigh not in list, "high" not in list → supported[0] = "low"
    expect(coerceCodexThinking("xhigh", ["low", "medium"])).toBe("low")
  })

  test("empty supported list → returns 'high' sentinel", () => {
    expect(coerceCodexThinking("xhigh", [])).toBe("high")
  })

  test("max with only low/medium → returns supported[0] = 'low'", () => {
    // max → xhigh → not in ["low","medium"], "high" not in list → supported[0] = "low"
    expect(coerceCodexThinking("max", ["low", "medium"])).toBe("low")
  })
})

describe("formatModelLabel", () => {
  test("undefined → empty string", () => {
    expect(formatModelLabel(undefined)).toBe("")
  })

  test("opus → Claude Opus 4.7", () => {
    expect(formatModelLabel("opus")).toBe("Claude Opus 4.7")
  })

  test("opus[1m] → Claude Opus 4.7 (1m suffix not detected by is1m heuristic)", () => {
    expect(formatModelLabel("opus[1m]")).toBe("Claude Opus 4.7")
  })

  test("sonnet → Claude Sonnet 4.6", () => {
    expect(formatModelLabel("sonnet")).toBe("Claude Sonnet 4.6")
  })

  test("haiku → Claude Haiku 4.5", () => {
    expect(formatModelLabel("haiku")).toBe("Claude Haiku 4.5")
  })

  test("gpt-5.4 → GPT-5.4", () => {
    expect(formatModelLabel("gpt-5.4")).toBe("GPT-5.4")
  })

  test("gpt-5.3-codex-spark → Codex 5.3 (prefix-matches gpt-5.3-codex first)", () => {
    expect(formatModelLabel("gpt-5.3-codex-spark")).toBe("Codex 5.3")
  })

  test("gpt-5.4-mini → GPT-5.4 (prefix-matches gpt-5.4 first)", () => {
    expect(formatModelLabel("gpt-5.4-mini")).toBe("GPT-5.4")
  })

  test("unknown id → returned as-is", () => {
    expect(formatModelLabel("unknown-model-xyz")).toBe("unknown-model-xyz")
  })
})

describe("formatClaudeThinkingLabel", () => {
  test("off → Off", () => {
    expect(formatClaudeThinkingLabel("off")).toBe("Off")
  })

  test("low → Low", () => {
    expect(formatClaudeThinkingLabel("low")).toBe("Low")
  })

  test("high → High", () => {
    expect(formatClaudeThinkingLabel("high")).toBe("High")
  })

  test("xhigh → Extra High", () => {
    expect(formatClaudeThinkingLabel("xhigh")).toBe("Extra High")
  })

  test("max → Max", () => {
    expect(formatClaudeThinkingLabel("max")).toBe("Max")
  })
})
