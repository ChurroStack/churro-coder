import { describe, test, expect, vi } from "vitest"
import {
  extractSearchableText,
  findMatches,
  splitTextByHighlights,
  debounce,
} from "./chat-search-utils"

function textMessage(id: string, text: string) {
  return { id, role: "user" as const, parts: [{ type: "text", text }] }
}

function assistantMessage(id: string, ...parts: { type: string; text?: string }[]) {
  return { id, role: "assistant" as const, parts }
}

describe("extractSearchableText", () => {
  test("user message → single entry at partIndex 0", () => {
    const messages = [textMessage("m1", "hello world")]
    const result = extractSearchableText(messages as any)
    expect(result).toHaveLength(1)
    expect(result[0]!.partIndex).toBe(0)
    expect(result[0]!.text).toBe("hello world")
    expect(result[0]!.messageId).toBe("m1")
  })

  test("user message with multiple text parts → consolidated into one entry", () => {
    const messages = [
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "part one" },
          { type: "text", text: "part two" },
        ],
      },
    ]
    const result = extractSearchableText(messages as any)
    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe("part one\npart two")
  })

  test("assistant message with text part → extracted at its partIndex", () => {
    const messages = [assistantMessage("m2", { type: "text", text: "I can help" })]
    const result = extractSearchableText(messages as any)
    expect(result).toHaveLength(1)
    expect(result[0]!.messageId).toBe("m2")
    expect(result[0]!.partIndex).toBe(0)
  })

  test("assistant non-text parts (tool) → not extracted", () => {
    const messages = [
      assistantMessage("m3", { type: "tool-Bash", text: undefined }),
    ]
    const result = extractSearchableText(messages as any)
    expect(result).toHaveLength(0)
  })

  test("empty text → not extracted", () => {
    const messages = [{ id: "m1", role: "user", parts: [{ type: "text", text: "   " }] }]
    const result = extractSearchableText(messages as any)
    expect(result).toHaveLength(0)
  })
})

describe("findMatches", () => {
  const texts = [
    { messageId: "m1", partIndex: 0, partType: "text", text: "hello world hello" },
    { messageId: "m2", partIndex: 0, partType: "text", text: "no match here" },
  ]

  test("empty query → no matches", () => {
    expect(findMatches(texts, "")).toHaveLength(0)
    expect(findMatches(texts, "   ")).toHaveLength(0)
  })

  test("finds all occurrences of query in texts", () => {
    const matches = findMatches(texts, "hello")
    expect(matches).toHaveLength(2)
    expect(matches[0]!.offset).toBe(0)
    expect(matches[1]!.offset).toBe(12)
  })

  test("match id encodes position uniquely", () => {
    const matches = findMatches(texts, "hello")
    expect(matches[0]!.id).toContain("m1")
    expect(matches[0]!.id).toContain("0")
  })

  test("case insensitive search", () => {
    const matches = findMatches(
      [{ messageId: "m1", partIndex: 0, partType: "text", text: "Hello World" }],
      "hello",
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]!.offset).toBe(0)
  })

  test("match length equals query length", () => {
    const matches = findMatches(texts, "world")
    expect(matches[0]!.length).toBe(5)
  })
})

describe("splitTextByHighlights", () => {
  test("no highlights → single non-highlight segment", () => {
    const segments = splitTextByHighlights("hello world", [])
    expect(segments).toHaveLength(1)
    expect(segments[0]!.text).toBe("hello world")
    expect(segments[0]!.isHighlight).toBe(false)
  })

  test("single highlight in middle → 3 segments", () => {
    const segments = splitTextByHighlights("hello world", [
      { offset: 6, length: 5, isCurrent: false },
    ])
    expect(segments).toHaveLength(2)
    expect(segments[0]!.text).toBe("hello ")
    expect(segments[0]!.isHighlight).toBe(false)
    expect(segments[1]!.text).toBe("world")
    expect(segments[1]!.isHighlight).toBe(true)
    expect(segments[1]!.isCurrent).toBe(false)
  })

  test("isCurrent flag propagated to highlight segment", () => {
    const segments = splitTextByHighlights("hello", [
      { offset: 0, length: 5, isCurrent: true },
    ])
    expect(segments[0]!.isCurrent).toBe(true)
  })

  test("highlight at start → no leading non-highlight segment", () => {
    const segments = splitTextByHighlights("hello world", [
      { offset: 0, length: 5, isCurrent: false },
    ])
    expect(segments[0]!.isHighlight).toBe(true)
    expect(segments[0]!.text).toBe("hello")
  })

  test("highlight at end → no trailing non-highlight segment after it", () => {
    const segments = splitTextByHighlights("hello world", [
      { offset: 6, length: 5, isCurrent: false },
    ])
    const last = segments[segments.length - 1]!
    expect(last.isHighlight).toBe(true)
    expect(last.text).toBe("world")
  })
})

describe("debounce", () => {
  test("fn not called immediately", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced()
    expect(fn).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  test("multiple rapid calls → only last one fires", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced()
    debounced()
    debounced()
    vi.runAllTimers()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  test("cancel() prevents the pending call", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced()
    debounced.cancel()
    vi.runAllTimers()
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
