import { describe, expect, test } from "vitest"
import { sortRows, type ModelRow } from "./model-breakdown"

function row(overrides: Partial<ModelRow>): ModelRow {
  return {
    model: "claude-opus-4-7",
    displayName: "Opus 4.7",
    provider: "claude",
    totalTokens: 1000,
    costUSD: 10,
    priced: true,
    rates: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    ...overrides,
  }
}

describe("sortRows", () => {
  test("tokens desc orders highest tokens first", () => {
    const rows = [
      row({ model: "a", totalTokens: 100 }),
      row({ model: "b", totalTokens: 1000 }),
      row({ model: "c", totalTokens: 10 }),
    ]
    expect(sortRows(rows, "tokens", "desc").map((r) => r.model)).toEqual(["b", "a", "c"])
  })

  test("tokens asc orders lowest tokens first", () => {
    const rows = [
      row({ model: "a", totalTokens: 100 }),
      row({ model: "b", totalTokens: 1000 }),
      row({ model: "c", totalTokens: 10 }),
    ]
    expect(sortRows(rows, "tokens", "asc").map((r) => r.model)).toEqual(["c", "a", "b"])
  })

  test("model sort uses displayName alphabetically", () => {
    const rows = [
      row({ model: "x", displayName: "Sonnet 4.6" }),
      row({ model: "y", displayName: "Haiku 4.5" }),
      row({ model: "z", displayName: "Opus 4.7" }),
    ]
    expect(sortRows(rows, "model", "asc").map((r) => r.displayName)).toEqual([
      "Haiku 4.5",
      "Opus 4.7",
      "Sonnet 4.6",
    ])
  })

  test("price sort uses input rate; unpriced rows sink to the end regardless of direction", () => {
    const rows = [
      row({ model: "cheap", rates: { input: 1, output: 5 } }),
      row({ model: "unpriced", rates: null, priced: false }),
      row({ model: "expensive", rates: { input: 15, output: 75 } }),
    ]
    expect(sortRows(rows, "price", "desc").map((r) => r.model)).toEqual([
      "expensive",
      "cheap",
      "unpriced",
    ])
    // Even ascending, unpriced stays last — never bubbles to the top.
    expect(sortRows(rows, "price", "asc").map((r) => r.model)).toEqual([
      "cheap",
      "expensive",
      "unpriced",
    ])
  })

  test("cost sort keeps unpriced rows at the end", () => {
    const rows = [
      row({ model: "a", costUSD: 5, priced: true }),
      row({ model: "unpriced", costUSD: 0, priced: false, rates: null }),
      row({ model: "b", costUSD: 100, priced: true }),
    ]
    expect(sortRows(rows, "cost", "desc").map((r) => r.model)).toEqual(["b", "a", "unpriced"])
    expect(sortRows(rows, "cost", "asc").map((r) => r.model)).toEqual(["a", "b", "unpriced"])
  })

  test("does not mutate the input array", () => {
    const rows = [row({ model: "a", totalTokens: 100 }), row({ model: "b", totalTokens: 1000 })]
    const before = rows.map((r) => r.model)
    sortRows(rows, "tokens", "desc")
    expect(rows.map((r) => r.model)).toEqual(before)
  })
})
