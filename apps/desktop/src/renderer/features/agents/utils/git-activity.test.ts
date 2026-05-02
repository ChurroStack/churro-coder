import { describe, test, expect } from "vitest"
import { extractGitActivity, extractChangedFiles } from "./git-activity"

function bashPart(command: string, stdout: string, stderr = ""): object {
  return {
    type: "tool-Bash",
    input: { command },
    output: { stdout, stderr },
  }
}

describe("extractGitActivity — commit detection", () => {
  test("git commit output with HEREDOC → extracts first line of HEREDOC message", () => {
    const part = bashPart(
      `git commit -m "$(cat <<'EOF'\nAdd feature\n\nSome details\nEOF\n)"`,
      "[main abc1234] Add feature\n 1 file changed",
    )
    const result = extractGitActivity([part])
    expect(result?.type).toBe("commit")
    if (result?.type === "commit") {
      expect(result.hash).toBe("abc1234")
      expect(result.message).toBe("Add feature")
    }
  })

  test("git commit with -m flag → extracts inline message", () => {
    const part = bashPart(
      `git commit -m "Fix the bug"`,
      "[main def5678] Fix the bug\n 2 files changed",
    )
    const result = extractGitActivity([part])
    expect(result?.type).toBe("commit")
    if (result?.type === "commit") {
      expect(result.message).toBe("Fix the bug")
      expect(result.hash).toBe("def5678")
    }
  })

  test("git commit stdout without branch prefix → no commit extracted", () => {
    const part = bashPart("git commit -m 'test'", "nothing to commit")
    const result = extractGitActivity([part])
    expect(result).toBeNull()
  })

  test("non-git-commit command → ignored", () => {
    const part = bashPart("ls -la", "[main abc] some output")
    const result = extractGitActivity([part])
    expect(result).toBeNull()
  })
})

describe("extractGitActivity — PR detection", () => {
  test("gh pr create with GitHub URL → extracts PR with number", () => {
    const part = bashPart(
      `gh pr create --base main --title "My feature"`,
      "Creating pull request for feature/test into main\nhttps://github.com/owner/repo/pull/42\n",
    )
    const result = extractGitActivity([part])
    expect(result?.type).toBe("pr")
    if (result?.type === "pr") {
      expect(result.url).toBe("https://github.com/owner/repo/pull/42")
      expect(result.number).toBe(42)
      expect(result.title).toBe("My feature")
    }
  })

  test("az repos pr create with JSON output → extracts Azure PR", () => {
    const azureJson = JSON.stringify({
      pullRequestId: 99,
      repository: { webUrl: "https://dev.azure.com/org/project/_git/repo" },
      title: "Azure PR",
    })
    const part = bashPart(
      `az repos pr create --source-branch feature/x --target-branch main --output json`,
      azureJson,
    )
    const result = extractGitActivity([part])
    expect(result?.type).toBe("pr")
    if (result?.type === "pr") {
      expect(result.number).toBe(99)
      expect(result.url).toBe(
        "https://dev.azure.com/org/project/_git/repo/pullrequest/99",
      )
    }
  })

  test("PR wins over commit when both exist", () => {
    const parts = [
      bashPart("git commit -m 'Fix'", "[main aaa111] Fix\n 1 file changed"),
      bashPart(
        "gh pr create --base main",
        "https://github.com/owner/repo/pull/7\n",
      ),
    ]
    const result = extractGitActivity(parts)
    expect(result?.type).toBe("pr")
  })

  test("az repos pr create without --output json → no PR extracted", () => {
    const part = bashPart(
      `az repos pr create --source-branch x --target-branch main`,
      "Created pull request #5.",
    )
    const result = extractGitActivity([part])
    expect(result).toBeNull()
  })
})

describe("extractGitActivity — push + rebase", () => {
  test("push after commit → commit marked as pushed", () => {
    const parts = [
      bashPart("git commit -m 'Init'", "[main aaa111] Init\n 1 file changed"),
      bashPart(
        "git push -u origin feature/x",
        "",
        "aaa111..bbb222 feature/x -> origin/feature/x",
      ),
    ]
    const result = extractGitActivity(parts)
    expect(result?.type).toBe("commit")
    if (result?.type === "commit") {
      expect(result.pushed).toBe(true)
    }
  })

  test("rebase + push → commit hash updated to post-push hash", () => {
    const parts = [
      bashPart("git commit -m 'Feature'", "[main aaa111] Feature\n 1 file changed"),
      bashPart("git pull --rebase origin main", "Successfully rebased"),
      bashPart(
        "git push origin feature/x",
        "",
        "aaa111..ccc333 feature/x -> origin/feature/x",
      ),
    ]
    const result = extractGitActivity(parts)
    expect(result?.type).toBe("commit")
    if (result?.type === "commit") {
      expect(result.hash).toBe("ccc333")
      expect(result.pushed).toBe(true)
    }
  })
})

describe("extractChangedFiles", () => {
  test("metadata changedFiles win over Edit part counts", () => {
    const parts = [
      {
        type: "tool-Edit",
        input: {
          file_path: "/project/src/foo.ts",
          old_string: "line1",
          new_string: "line1\nline2",
        },
      },
    ]
    const metadata = {
      changedFiles: [
        { filePath: "/project/src/foo.ts", additions: 10, deletions: 3 },
      ],
    }
    const result = extractChangedFiles(parts, "/project", metadata)
    expect(result).toHaveLength(1)
    expect(result[0]!.additions).toBe(10)
    expect(result[0]!.deletions).toBe(3)
  })

  test("filters out claude-sessions paths", () => {
    const parts = [
      { type: "tool-Write", input: { file_path: "/home/user/.claude/claude-sessions/abc.md", content: "x" } },
      { type: "tool-Write", input: { file_path: "/project/src/real.ts", content: "x" } },
    ]
    const result = extractChangedFiles(parts, "/project")
    expect(result).toHaveLength(1)
    expect(result[0]!.filePath).toBe("/project/src/real.ts")
  })

  test("filters out Application Support paths", () => {
    const parts = [
      { type: "tool-Write", input: { file_path: "/Users/user/Library/Application Support/data.db", content: "x" } },
    ]
    const result = extractChangedFiles(parts)
    expect(result).toHaveLength(0)
  })

  test("Edit tool: counts old_string lines as deletions, new_string lines as additions", () => {
    const parts = [
      {
        type: "tool-Edit",
        input: {
          file_path: "/project/src/bar.ts",
          old_string: "a\nb\nc",
          new_string: "a\nb",
        },
      },
    ]
    const result = extractChangedFiles(parts, "/project")
    expect(result[0]!.additions).toBe(2)
    expect(result[0]!.deletions).toBe(3)
  })

  test("Write tool: counts content lines as additions, 0 deletions", () => {
    const parts = [
      {
        type: "tool-Write",
        input: { file_path: "/project/new.ts", content: "line1\nline2\nline3" },
      },
    ]
    const result = extractChangedFiles(parts, "/project")
    expect(result[0]!.additions).toBe(3)
    expect(result[0]!.deletions).toBe(0)
  })

  test("displayPath is relative to projectPath", () => {
    const parts = [
      { type: "tool-Write", input: { file_path: "/project/src/utils.ts", content: "x" } },
    ]
    const result = extractChangedFiles(parts, "/project")
    expect(result[0]!.displayPath).toBe("src/utils.ts")
  })
})
