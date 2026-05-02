// Pure helpers for commit-input decision logic.
// No React, tRPC, or Jotai imports — safe to unit test in Node.

export function getCommitGenerationNeeds(
	title: string,
	description: string,
	chatId?: string,
): { needsTitle: boolean; needsDescription: boolean; shouldGenerate: boolean } {
	const commitTitle = title.trim()
	const commitDescription = description.trim()
	const needsTitle = !commitTitle && !!chatId
	const needsDescription = !commitDescription && !!chatId
	const shouldGenerate = (needsTitle || needsDescription) && !!chatId
	return { needsTitle, needsDescription, shouldGenerate }
}

export function buildFinalCommitMessage(title: string, description: string): string {
	const t = title.trim()
	const d = description.trim()
	return d ? `${t}\n\n${d}` : t
}
