import { describe, expect, test } from "vitest"
import { formatUSDPerMTok } from "./format"

describe("formatUSDPerMTok", () => {
  test("whole numbers render with no decimals", () => {
    expect(formatUSDPerMTok(5)).toBe("$5")
    expect(formatUSDPerMTok(25)).toBe("$25")
    expect(formatUSDPerMTok(0)).toBe("$0")
  })

  test("fractional values keep significant digits", () => {
    expect(formatUSDPerMTok(0.5)).toBe("$0.5")
    expect(formatUSDPerMTok(1.25)).toBe("$1.25")
    expect(formatUSDPerMTok(3.75)).toBe("$3.75")
  })

  test("three-decimal cache rates render without truncation", () => {
    // GPT-5.4 mini cache_read = $0.075/MTok — must not collapse to "$0.08" or "$0.07".
    expect(formatUSDPerMTok(0.075)).toBe("$0.075")
    expect(formatUSDPerMTok(0.025)).toBe("$0.025")
    expect(formatUSDPerMTok(0.175)).toBe("$0.175")
  })

  test("trailing zeros are stripped", () => {
    expect(formatUSDPerMTok(0.3)).toBe("$0.3")
    expect(formatUSDPerMTok(0.1)).toBe("$0.1")
    expect(formatUSDPerMTok(2.5)).toBe("$2.5")
  })

  test("non-finite values fall back to $0", () => {
    expect(formatUSDPerMTok(Number.NaN)).toBe("$0")
    expect(formatUSDPerMTok(Number.POSITIVE_INFINITY)).toBe("$0")
    expect(formatUSDPerMTok(Number.NEGATIVE_INFINITY)).toBe("$0")
  })
})
