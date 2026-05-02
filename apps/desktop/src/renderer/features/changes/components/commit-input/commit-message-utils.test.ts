import { describe, test, expect } from "vitest"
import { getCommitGenerationNeeds, buildFinalCommitMessage } from "./commit-message-utils"

// ---------------------------------------------------------------------------
// getCommitGenerationNeeds — three-branch decision logic
// ---------------------------------------------------------------------------

describe("getCommitGenerationNeeds", () => {
	test("both fields empty + chatId → needs both, should generate", () => {
		expect(getCommitGenerationNeeds("", "", "chat-1")).toEqual({
			needsTitle: true,
			needsDescription: true,
			shouldGenerate: true,
		})
	})

	test("title filled + description empty + chatId → needs only description", () => {
		expect(getCommitGenerationNeeds("feat: my feature", "", "chat-1")).toEqual({
			needsTitle: false,
			needsDescription: true,
			shouldGenerate: true,
		})
	})

	test("title empty + description filled + chatId → needs only title", () => {
		expect(getCommitGenerationNeeds("", "Some explanation.", "chat-1")).toEqual({
			needsTitle: true,
			needsDescription: false,
			shouldGenerate: true,
		})
	})

	test("both filled → no generation needed", () => {
		expect(getCommitGenerationNeeds("feat: title", "Body text.", "chat-1")).toEqual({
			needsTitle: false,
			needsDescription: false,
			shouldGenerate: false,
		})
	})

	test("no chatId + both empty → shouldGenerate is false (no AI without a chat)", () => {
		const result = getCommitGenerationNeeds("", "", undefined)
		expect(result.shouldGenerate).toBe(false)
		expect(result.needsTitle).toBe(false)
		expect(result.needsDescription).toBe(false)
	})

	test("no chatId + both empty (empty string chatId) → shouldGenerate is false", () => {
		expect(getCommitGenerationNeeds("", "", "").shouldGenerate).toBe(false)
	})

	test("whitespace-only title is treated as empty", () => {
		expect(getCommitGenerationNeeds("   ", "", "chat-1").needsTitle).toBe(true)
	})

	test("whitespace-only description is treated as empty", () => {
		expect(getCommitGenerationNeeds("feat: title", "  \n  ", "chat-1").needsDescription).toBe(true)
	})

	test("whitespace-only both fields → needs both", () => {
		const result = getCommitGenerationNeeds("  ", " ", "chat-1")
		expect(result.needsTitle).toBe(true)
		expect(result.needsDescription).toBe(true)
		expect(result.shouldGenerate).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// buildFinalCommitMessage
// ---------------------------------------------------------------------------

describe("buildFinalCommitMessage", () => {
	test("title + description joined with double newline", () => {
		expect(buildFinalCommitMessage("feat: add X", "Explains why.")).toBe(
			"feat: add X\n\nExplains why.",
		)
	})

	test("empty description → returns just the title", () => {
		expect(buildFinalCommitMessage("fix: patch", "")).toBe("fix: patch")
	})

	test("whitespace-only description → returns just the title", () => {
		expect(buildFinalCommitMessage("fix: patch", "  ")).toBe("fix: patch")
	})

	test("multiline description is preserved", () => {
		const desc = "Line one.\nLine two.\nLine three."
		expect(buildFinalCommitMessage("chore: update", desc)).toBe(
			`chore: update\n\n${desc}`,
		)
	})

	test("trims leading/trailing whitespace from title and description", () => {
		expect(buildFinalCommitMessage("  feat: add X  ", "  Body.  ")).toBe(
			"feat: add X\n\nBody.",
		)
	})
})
