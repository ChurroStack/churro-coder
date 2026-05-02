import { describe, test, expect } from "vitest"
import {
	parseClaudeCommitResponse,
	parseOllamaCommitResponse,
	buildHeuristicCommitMessage,
	type CommitFileInfo,
} from "./commit-message-helpers"

// ---------------------------------------------------------------------------
// parseClaudeCommitResponse
// ---------------------------------------------------------------------------

describe("parseClaudeCommitResponse", () => {
	test("parses clean JSON response", () => {
		const text = '{"title":"feat: add auth","description":"Adds JWT-based auth."}'
		expect(parseClaudeCommitResponse(text)).toEqual({
			title: "feat: add auth",
			description: "Adds JWT-based auth.",
		})
	})

	test("extracts JSON embedded in surrounding prose", () => {
		const text =
			'Here is the commit: {"title":"fix: resolve crash","description":"Fixes the null pointer."}'
		expect(parseClaudeCommitResponse(text)).toEqual({
			title: "fix: resolve crash",
			description: "Fixes the null pointer.",
		})
	})

	test("truncates title to 72 chars", () => {
		const longTitle = "feat: " + "a".repeat(80)
		const text = JSON.stringify({ title: longTitle, description: "desc" })
		const result = parseClaudeCommitResponse(text)
		expect(result?.title.length).toBeLessThanOrEqual(72)
	})

	test("JSON with missing description returns empty description string", () => {
		const text = '{"title":"chore: cleanup"}'
		const result = parseClaudeCommitResponse(text)
		expect(result?.title).toBe("chore: cleanup")
		expect(result?.description).toBe("")
	})

	test("response with no JSON-like content → line-split runs cleanly", () => {
		// When Claude returns plain text (no braces), line-split is the only path
		const text = "feat: add feature\nExplains the rationale."
		const result = parseClaudeCommitResponse(text)
		expect(result?.title).toBe("feat: add feature")
		expect(result?.description).toBe("Explains the rationale.")
	})

	test("falls back to line-split on invalid JSON", () => {
		const text = "feat: add feature\n\nExplains why the change was made."
		const result = parseClaudeCommitResponse(text)
		expect(result?.title).toBe("feat: add feature")
		expect(result?.description).toBe("Explains why the change was made.")
	})

	test("line-split: empty description when response is a single line", () => {
		expect(parseClaudeCommitResponse("fix: single line only")).toEqual({
			title: "fix: single line only",
			description: "",
		})
	})

	test("returns null for empty text", () => {
		expect(parseClaudeCommitResponse("")).toBeNull()
	})

	test("returns null for whitespace-only text", () => {
		expect(parseClaudeCommitResponse("   \n  ")).toBeNull()
	})

	test("existingTitle variant: returns title + description from response body", () => {
		const result = parseClaudeCommitResponse(
			"Uses an abort controller to cancel in-flight requests.",
			"fix: cancel requests",
		)
		expect(result).toEqual({
			title: "fix: cancel requests",
			description: "Uses an abort controller to cancel in-flight requests.",
		})
	})

	test("existingTitle variant: strips leading 'Description:' prefix (case-insensitive)", () => {
		const result = parseClaudeCommitResponse("Description: Adds retry logic.", "feat: retry")
		expect(result?.description).toBe("Adds retry logic.")
		expect(result?.title).toBe("feat: retry")
	})

	test("existingTitle variant: ignores JSON in response body and uses raw text", () => {
		// When existingTitle is set, the response is expected to be plain description text,
		// not JSON. We should not try to parse it as JSON.
		const result = parseClaudeCommitResponse('{"some":"json"}', "fix: existing")
		expect(result?.title).toBe("fix: existing")
		expect(result?.description).toBe('{"some":"json"}')
	})
})

// ---------------------------------------------------------------------------
// parseOllamaCommitResponse
// ---------------------------------------------------------------------------

describe("parseOllamaCommitResponse", () => {
	test("first line = title, remainder after blank = description", () => {
		const response = "feat: add caching\n\nReduces API calls by caching results in memory."
		const result = parseOllamaCommitResponse(response)
		expect(result?.title).toBe("feat: add caching")
		expect(result?.description).toBe("Reduces API calls by caching results in memory.")
	})

	test("title-only response gives empty description", () => {
		const result = parseOllamaCommitResponse("fix: patch null check")
		expect(result).toEqual({ title: "fix: patch null check", description: "" })
	})

	test("returns null when title-line is ≥100 chars (model echoed the diff)", () => {
		const longLine = "feat: " + "a".repeat(100)
		expect(parseOllamaCommitResponse(longLine)).toBeNull()
	})

	test("returns null for empty response", () => {
		expect(parseOllamaCommitResponse("")).toBeNull()
	})

	test("returns null for whitespace-only response", () => {
		expect(parseOllamaCommitResponse("   \n  ")).toBeNull()
	})

	test("skips the blank separator line but keeps subsequent description lines", () => {
		const response = "chore: cleanup\n\nRemoves unused imports.\nAlso removes dead code."
		const result = parseOllamaCommitResponse(response)
		expect(result?.description).toContain("Removes unused imports.")
		expect(result?.description).toContain("Also removes dead code.")
	})

	test("existingTitle variant: keeps title, uses full response as description", () => {
		const result = parseOllamaCommitResponse("Improves startup time by lazy-loading modules.", "perf: faster boot")
		expect(result?.title).toBe("perf: faster boot")
		expect(result?.description).toBe("Improves startup time by lazy-loading modules.")
	})

	test("existingTitle variant: strips leading 'Description:' prefix", () => {
		const result = parseOllamaCommitResponse("Description: Fixes the race condition.", "fix: race")
		expect(result?.description).toBe("Fixes the race condition.")
	})
})

// ---------------------------------------------------------------------------
// buildHeuristicCommitMessage
// ---------------------------------------------------------------------------

function makeFile(
	newPath: string,
	additions = 5,
	deletions = 2,
	oldPath = "apps/src/placeholder.ts",
): CommitFileInfo {
	return { oldPath, newPath, additions, deletions }
}

describe("buildHeuristicCommitMessage — prefix detection", () => {
	test("new file (oldPath=/dev/null) → feat prefix", () => {
		const files: CommitFileInfo[] = [
			{ oldPath: "/dev/null", newPath: "src/new-feature.ts", additions: 10, deletions: 0 },
		]
		expect(buildHeuristicCommitMessage(files).title).toMatch(/^feat:/)
	})

	test("only-deletions file → chore prefix", () => {
		const files: CommitFileInfo[] = [
			{ oldPath: "src/old.ts", newPath: "src/old.ts", additions: 0, deletions: 5 },
		]
		expect(buildHeuristicCommitMessage(files).title).toMatch(/^chore:/)
	})

	test("test file → test prefix", () => {
		expect(buildHeuristicCommitMessage([makeFile("src/foo.test.ts")]).title).toMatch(/^test:/)
	})

	test("spec file → test prefix", () => {
		expect(buildHeuristicCommitMessage([makeFile("src/bar.spec.ts")]).title).toMatch(/^test:/)
	})

	test("markdown file → docs prefix", () => {
		expect(buildHeuristicCommitMessage([makeFile("docs/readme.md")]).title).toMatch(/^docs:/)
	})

	test("path containing 'fix' → fix prefix", () => {
		expect(buildHeuristicCommitMessage([makeFile("src/hotfix.ts")]).title).toMatch(/^fix:/)
	})

	test("regular modified file → fix prefix (fallthrough: additions or deletions > 0)", () => {
		expect(buildHeuristicCommitMessage([makeFile("src/component.tsx")]).title).toMatch(/^fix:/)
	})
})

describe("buildHeuristicCommitMessage — title formatting", () => {
	test("single unique file → uses file name in title", () => {
		const result = buildHeuristicCommitMessage([makeFile("src/utils.ts")])
		expect(result.title).toContain("utils.ts")
	})

	test("two unique files → lists both names", () => {
		const result = buildHeuristicCommitMessage([makeFile("src/a.ts"), makeFile("src/b.ts")])
		expect(result.title).toContain("a.ts")
		expect(result.title).toContain("b.ts")
	})

	test("three unique files → lists all names", () => {
		const files = [makeFile("src/a.ts"), makeFile("src/b.ts"), makeFile("src/c.ts")]
		const result = buildHeuristicCommitMessage(files)
		expect(result.title).toContain("a.ts")
		expect(result.title).toContain("b.ts")
		expect(result.title).toContain("c.ts")
	})

	test(">3 unique files → shows count instead of names", () => {
		const files = [
			makeFile("src/a.ts"),
			makeFile("src/b.ts"),
			makeFile("src/c.ts"),
			makeFile("src/d.ts"),
		]
		expect(buildHeuristicCommitMessage(files).title).toMatch(/update 4 files/)
	})

	test("duplicate file names (same basename, different dirs) counted as one unique", () => {
		const files = [makeFile("src/index.ts"), makeFile("lib/index.ts")]
		const result = buildHeuristicCommitMessage(files)
		// Both files have basename "index.ts" → 1 unique name → singular form
		expect(result.title).toMatch(/update index\.ts/)
	})
})

describe("buildHeuristicCommitMessage — description", () => {
	test("description mentions the file name for a single-file change", () => {
		const files: CommitFileInfo[] = [
			{ oldPath: "old.ts", newPath: "src/foo.ts", additions: 12, deletions: 3 },
		]
		const desc = buildHeuristicCommitMessage(files).description
		expect(desc).toContain("foo.ts")
	})

	test("description includes addition/deletion counts", () => {
		const files: CommitFileInfo[] = [
			{ oldPath: "old.ts", newPath: "src/foo.ts", additions: 12, deletions: 3 },
		]
		const desc = buildHeuristicCommitMessage(files).description
		expect(desc).toMatch(/12/)
		expect(desc).toMatch(/3/)
	})

	test("deleted file description mentions removal", () => {
		const files: CommitFileInfo[] = [
			{ oldPath: "src/removed.ts", newPath: "/dev/null", additions: 0, deletions: 8 },
		]
		const desc = buildHeuristicCommitMessage(files).description
		expect(desc.toLowerCase()).toContain("removed")
	})

	test("multi-file change description mentions file count", () => {
		const files = Array.from({ length: 10 }, (_, i) => makeFile(`src/file${i}.ts`))
		const result = buildHeuristicCommitMessage(files)
		expect(result.description).toContain("10")
	})

	test("new file description mentions addition", () => {
		const files: CommitFileInfo[] = [
			{ oldPath: "/dev/null", newPath: "src/new.ts", additions: 20, deletions: 0 },
		]
		const desc = buildHeuristicCommitMessage(files).description
		expect(desc.toLowerCase()).toContain("added")
	})
})

describe("buildHeuristicCommitMessage — existingTitle", () => {
	test("preserves user-provided title verbatim", () => {
		const result = buildHeuristicCommitMessage([makeFile("src/foo.ts")], "my custom title")
		expect(result.title).toBe("my custom title")
	})

	test("skips description when existingTitle is provided", () => {
		const result = buildHeuristicCommitMessage([makeFile("src/foo.ts")], "my custom title")
		expect(result.description).toBe("")
	})
})
