import { describe, test, expect } from "vitest"
import { generatePrMessage, generateCommitToPrMessage, generateReviewMessage } from "./pr-message"
import type { PrContext } from "./pr-message"

const baseCtx: PrContext = {
  branch: "feature/my-branch",
  baseBranch: "main",
  uncommittedCount: 0,
  hasUpstream: true,
}

describe("generatePrMessage — GitHub", () => {
  test("committed, upstream exists → single step: gh pr create", () => {
    const msg = generatePrMessage(baseCtx)
    expect(msg).toContain("gh pr create --base main")
    expect(msg).not.toContain("Run git diff to review uncommitted changes")
    expect(msg).not.toContain("Push to origin")
  })

  test("uncommitted changes → includes 'commit' step", () => {
    const msg = generatePrMessage({ ...baseCtx, uncommittedCount: 3 })
    expect(msg).toContain("3 uncommitted changes")
    expect(msg).toContain("Run git diff")
    expect(msg).toContain("Commit them")
  })

  test("no upstream → includes push step", () => {
    const msg = generatePrMessage({ ...baseCtx, hasUpstream: false })
    expect(msg).toContain("Push to origin")
  })

  test("null provider → defaults to GitHub gh command", () => {
    const msg = generatePrMessage({ ...baseCtx, provider: null })
    expect(msg).toContain("gh pr create --base main")
  })
})

describe("generatePrMessage — Azure", () => {
  const azureCtx: PrContext = {
    ...baseCtx,
    provider: "azure",
    azure: {
      organization: "myorg",
      project: "myproject",
      repository: "myrepo",
    },
  }

  test("uses az repos pr create command", () => {
    const msg = generatePrMessage(azureCtx)
    expect(msg).toContain("az repos pr create")
    expect(msg).toContain("--source-branch feature/my-branch")
    expect(msg).toContain("--target-branch main")
    expect(msg).toContain("--repository myrepo")
    expect(msg).toContain("--organization https://dev.azure.com/myorg")
  })

  test("does NOT include gh pr create", () => {
    const msg = generatePrMessage(azureCtx)
    expect(msg).not.toContain("gh pr create")
  })
})

describe("generateCommitToPrMessage", () => {
  test("0 uncommitted → short-circuit message", () => {
    const msg = generateCommitToPrMessage({ ...baseCtx, uncommittedCount: 0 })
    expect(msg).toContain("All changes are already committed")
    expect(msg).toContain("feature/my-branch")
    expect(msg).not.toContain("git diff")
  })

  test("uncommitted > 0 → includes commit + push steps", () => {
    const msg = generateCommitToPrMessage({ ...baseCtx, uncommittedCount: 2 })
    expect(msg).toContain("2 uncommitted changes")
    expect(msg).toContain("git diff")
    expect(msg).toContain("Push to origin")
  })
})

describe("generateReviewMessage", () => {
  test("no scopedFiles → full branch diff command", () => {
    const msg = generateReviewMessage(baseCtx)
    expect(msg).toContain("git diff origin/main...")
    expect(msg).not.toContain("## Scope")
  })

  test("empty scopedFiles array → full branch diff (no scope)", () => {
    const msg = generateReviewMessage(baseCtx, [])
    expect(msg).not.toContain("## Scope")
  })

  test("scopedFiles provided → scoped diff command with quoted paths", () => {
    const msg = generateReviewMessage(baseCtx, ["src/a.ts", "src/b.ts"])
    expect(msg).toContain("git diff origin/main... -- 'src/a.ts' 'src/b.ts'")
    expect(msg).toContain("## Scope")
    expect(msg).toContain("- src/a.ts")
    expect(msg).toContain("- src/b.ts")
  })

  test("path with embedded single quote → shellQuote escapes it", () => {
    const msg = generateReviewMessage(baseCtx, ["src/it's-a-test.ts"])
    expect(msg).toContain("'src/it'\\''s-a-test.ts'")
  })

  test("branch and baseBranch appear in review instructions", () => {
    const msg = generateReviewMessage(baseCtx)
    expect(msg).toContain("feature/my-branch")
    expect(msg).toContain("origin/main")
  })
})
