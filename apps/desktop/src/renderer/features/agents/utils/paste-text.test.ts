// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { toast } from "sonner"
import { insertTextAtCursor } from "./paste-text"

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
  },
}))

function makeElement(existingText = ""): Element {
  const el = document.createElement("div")
  el.setAttribute("contenteditable", "true")
  el.textContent = existingText
  document.body.appendChild(el)
  return el
}

let execCommandMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  document.body.innerHTML = ""
  vi.mocked(toast.warning).mockClear()
  execCommandMock = vi.fn().mockReturnValue(true)
  Object.defineProperty(document, "execCommand", {
    value: execCommandMock,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("insertTextAtCursor", () => {
  test("short text → execCommand called with full text", () => {
    const el = makeElement("")
    insertTextAtCursor("hello", el)
    expect(execCommandMock).toHaveBeenCalledWith("insertText", false, "hello")
  })

  test("text fits within limit → no toast shown", () => {
    const el = makeElement("")
    insertTextAtCursor("short", el)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  test("text longer than available space → truncated, toast shown", () => {
    // Fill element with 9900 chars, then paste 200 chars (available = 100)
    const el = makeElement("x".repeat(9900))
    insertTextAtCursor("y".repeat(200), el)
    const call = execCommandMock.mock.calls[0]!
    expect((call[2] as string).length).toBe(100)
    expect(toast.warning).toHaveBeenCalled()
  })

  test("availableSpace = 0 → no execCommand, 'input is full' toast", () => {
    const el = makeElement("x".repeat(10_000))
    insertTextAtCursor("more text", el)
    expect(execCommandMock).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(
      "Cannot paste: input is full",
      expect.any(Object),
    )
  })

  test("text > VERY_LARGE_THRESHOLD → 'Text truncated' MB toast", () => {
    const el = makeElement("")
    const bigText = "a".repeat(1_100_000)
    insertTextAtCursor(bigText, el)
    expect(toast.warning).toHaveBeenCalledWith(
      "Text truncated",
      expect.objectContaining({ description: expect.stringContaining("MB") }),
    )
  })
})
