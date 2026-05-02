import { describe, expect, test } from "vitest"
import { aggregate } from "./aggregator"
import type { UsageEntry } from "./types"

const NOW = Date.parse("2026-05-02T12:00:00Z")

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    ts: NOW - 60_000,
    model: "claude-opus-4-7",
    source: "claude",
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    dedupKey: null,
    costUSD: null,
    ...overrides,
  }
}

describe("aggregate — model rates", () => {
  test("priced Claude model exposes full rate set including cache rates", () => {
    const result = aggregate([entry({ model: "claude-opus-4-7" })], "all", "all", NOW)
    expect(result.models).toHaveLength(1)
    const row = result.models[0]!
    expect(row.priced).toBe(true)
    expect(row.rates).not.toBeNull()
    expect(row.rates).toEqual({ input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 })
  })

  test("priced Codex model exposes input/output/cacheRead but no cacheWrite", () => {
    const result = aggregate(
      [entry({ model: "gpt-5.4", source: "codex" })],
      "all",
      "all",
      NOW,
    )
    const row = result.models[0]!
    expect(row.priced).toBe(true)
    expect(row.rates).toEqual({ input: 2.5, output: 15, cacheRead: 0.25 })
    expect(row.rates?.cacheWrite).toBeUndefined()
  })

  test("unpriced model row carries rates: null and priced: false", () => {
    const result = aggregate(
      [entry({ model: "synthetic-future-model", source: "claude" })],
      "all",
      "all",
      NOW,
    )
    expect(result.models).toHaveLength(1)
    const row = result.models[0]!
    expect(row.priced).toBe(false)
    expect(row.rates).toBeNull()
    expect(result.totals.unpricedModels).toEqual(["synthetic-future-model"])
  })

  test("dated model variant resolves to base entry's rates via prefix match", () => {
    // priceFor uses longest-prefix matching, so "claude-opus-4-7-20250929"
    // should resolve to the "claude-opus-4-7" entry.
    const result = aggregate(
      [entry({ model: "claude-opus-4-7-20250929" })],
      "all",
      "all",
      NOW,
    )
    const row = result.models[0]!
    expect(row.priced).toBe(true)
    expect(row.displayName).toBe("Opus 4.7")
    expect(row.rates).toEqual({ input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 })
  })

  test("multiple entries for the same model collapse into one row with shared rates", () => {
    const result = aggregate(
      [
        entry({ model: "claude-haiku-4-5", inputTokens: 500, outputTokens: 100 }),
        entry({ model: "claude-haiku-4-5", inputTokens: 700, outputTokens: 200 }),
      ],
      "all",
      "all",
      NOW,
    )
    expect(result.models).toHaveLength(1)
    const row = result.models[0]!
    expect(row.totalTokens).toBe(500 + 100 + 700 + 200)
    expect(row.rates).toEqual({ input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 })
  })

  test("priced + unpriced entries return mixed rows in the same payload", () => {
    const result = aggregate(
      [
        entry({ model: "claude-opus-4-7" }),
        entry({ model: "synthetic-test", source: "claude" }),
      ],
      "all",
      "all",
      NOW,
    )
    const byModel = new Map(result.models.map((r) => [r.model, r]))
    expect(byModel.get("claude-opus-4-7")?.rates).not.toBeNull()
    expect(byModel.get("synthetic-test")?.rates).toBeNull()
    expect(byModel.get("synthetic-test")?.priced).toBe(false)
  })
})
