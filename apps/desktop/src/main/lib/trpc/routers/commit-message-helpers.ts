// Pure helpers for commit message parsing and heuristic generation.
// No Electron, tRPC, or DB imports — keep this file unit-testable in Node.

export function parseClaudeCommitResponse(
	text: string,
	existingTitle?: string,
): { title: string; description: string } | null {
	if (!text?.trim()) return null

	if (existingTitle) {
		const description = text.replace(/^description:\s*/i, "").trim()
		return { title: existingTitle, description }
	}

	// Try JSON parse first (Claude is instructed to return JSON)
	try {
		const jsonMatch = text.match(/\{[\s\S]*\}/)
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0])
			const title = (parsed.title ?? "").slice(0, 72).trim()
			const description = (parsed.description ?? "").trim()
			if (title) return { title, description }
		}
	} catch {
		// fall through to line-split
	}

	// Fallback: first line = title, rest = description
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
	const title = (lines[0] ?? "").slice(0, 72)
	const description = lines.slice(1).join("\n").trim()
	return title ? { title, description } : null
}

export function parseOllamaCommitResponse(
	result: string,
	existingTitle?: string,
): { title: string; description: string } | null {
	if (!result?.trim()) return null

	if (existingTitle) {
		const description = result.replace(/^description:\s*/i, "").trim()
		return { title: existingTitle, description }
	}

	const lines = result.split("\n")
	const titleLine = lines[0]?.trim() ?? ""
	// Ollama sometimes echoes back the whole diff — reject suspiciously long lines
	if (!titleLine || titleLine.length >= 100) return null

	const descLines = lines.slice(1).filter((l, i) => {
		// skip the blank-line separator immediately after the title
		if (i === 0 && !l.trim()) return false
		return true
	})
	const description = descLines.join("\n").trim()

	return { title: titleLine, description }
}

export interface CommitFileInfo {
	oldPath: string
	newPath: string
	additions: number
	deletions: number
}

export function buildHeuristicCommitMessage(
	files: CommitFileInfo[],
	existingTitle?: string,
): { title: string; description: string } {
	const allPaths = files.map((f) => (f.newPath !== "/dev/null" ? f.newPath : f.oldPath))
	const fileNames = allPaths.map((p) => p.split("/").pop() || p)

	const hasNewFiles = files.some((f) => f.oldPath === "/dev/null")
	const hasDeletedFiles = files.some((f) => f.newPath === "/dev/null")
	const hasOnlyDeletions = files.every((f) => f.additions === 0 && f.deletions > 0)
	const hasTestFiles = allPaths.some((p) => p.includes("test") || p.includes("spec"))
	const hasDocFiles = allPaths.some((p) => p.endsWith(".md") || p.includes("doc"))
	const hasConfigFiles = allPaths.some((p) =>
		p.includes("config") ||
		p.endsWith(".json") ||
		p.endsWith(".yaml") ||
		p.endsWith(".yml") ||
		p.endsWith(".toml"),
	)

	let prefix = "chore"
	if (hasNewFiles && !hasDeletedFiles) prefix = "feat"
	else if (hasOnlyDeletions) prefix = "chore"
	else if (hasTestFiles && !hasDocFiles && !hasConfigFiles) prefix = "test"
	else if (hasDocFiles && !hasTestFiles && !hasConfigFiles) prefix = "docs"
	else if (allPaths.some((p) => p.includes("fix") || p.includes("bug"))) prefix = "fix"
	else if (files.every((f) => f.additions > 0 || f.deletions > 0)) prefix = "fix"

	const uniqueFileNames = [...new Set(fileNames)]
	let title: string
	if (existingTitle) {
		title = existingTitle
	} else if (uniqueFileNames.length === 1) {
		title = `${prefix}: update ${uniqueFileNames[0]}`
	} else if (uniqueFileNames.length <= 3) {
		title = `${prefix}: update ${uniqueFileNames.join(", ")}`
	} else {
		title = `${prefix}: update ${uniqueFileNames.length} files`
	}

	// Build a human-readable description; skip when user already provided the intent via existingTitle
	let description = ""
	if (!existingTitle) {
		const totalAdditions = files.reduce((n, f) => n + f.additions, 0)
		const totalDeletions = files.reduce((n, f) => n + f.deletions, 0)
		const parts: string[] = []

		if (hasNewFiles && !hasDeletedFiles) {
			parts.push(`Added ${files.length === 1 ? uniqueFileNames[0] ?? "new file" : `${files.length} new files`}.`)
		} else if (hasOnlyDeletions) {
			parts.push(`Removed ${files.length === 1 ? uniqueFileNames[0] ?? "file" : `${files.length} files`}.`)
		} else {
			parts.push(`Updated ${files.length === 1 ? uniqueFileNames[0] ?? "file" : `${files.length} files`}.`)
		}

		parts.push(`${totalAdditions} line${totalAdditions === 1 ? "" : "s"} added, ${totalDeletions} removed.`)
		description = parts.join(" ")
	}

	return { title, description }
}
