export interface PrContext {
  branch: string
  baseBranch: string
  uncommittedCount: number
  hasUpstream: boolean
  /** Git host provider for this workspace. Null/undefined → treat as GitHub. */
  provider?: "github" | "azure" | null
  /** Populated when provider === "azure" so the agent can target the right org/project/repo. */
  azure?: {
    organization: string
    project: string
    repository: string
  }
}

/**
 * Generates a message for Claude to create a PR
 */
export function generatePrMessage(context: PrContext): string {
  const { branch, baseBranch, uncommittedCount, hasUpstream } = context

  const lines = [
    uncommittedCount > 0
      ? `There are ${uncommittedCount} uncommitted changes.`
      : "All changes are committed.",
    `The current branch is ${branch}.`,
    `The target branch is origin/${baseBranch}.`,
    hasUpstream
      ? "The branch is already pushed to remote."
      : "There is no upstream branch yet.",
    "The user requested a PR.",
    "",
    "Follow these exact steps to create a PR:",
    "",
  ]

  const steps: string[] = []

  if (uncommittedCount > 0) {
    steps.push("Run git diff to review uncommitted changes")
    steps.push("Commit them. Write a clear, concise commit message.")
  }

  if (!hasUpstream) {
    steps.push("Push to origin")
  }

  steps.push(`Use git diff origin/${baseBranch}... to review the PR diff`)
  if (context.provider === "azure" && context.azure) {
    const { organization, project, repository } = context.azure
    steps.push(
      `Use az repos pr create --source-branch ${branch} --target-branch ${baseBranch} ` +
        `--repository ${repository} --project "${project}" ` +
        `--organization https://dev.azure.com/${organization} ` +
        `--title "<title>" --description "<summary>" --output json ` +
        `to create a PR. Keep the title under 80 characters and description under five sentences.`,
    )
  } else {
    steps.push(
      `Use gh pr create --base ${baseBranch} to create a PR. Keep the title under 80 characters and description under five sentences.`,
    )
  }
  steps.push("If any of these steps fail, ask the user for help.")

  // Add numbered steps
  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step}`)
  })

  return lines.join("\n")
}

/**
 * Generates a message for Claude to commit and push changes to an existing PR
 */
export function generateCommitToPrMessage(context: PrContext): string {
  const { branch, baseBranch, uncommittedCount } = context

  if (uncommittedCount === 0) {
    return `All changes are already committed. The branch ${branch} is up to date.`
  }

  return `There are ${uncommittedCount} uncommitted changes on branch ${branch}.
The PR already exists and targets origin/${baseBranch}.

Please commit and push these changes to update the PR:

1. Run git diff to review uncommitted changes
2. Commit them with a clear, concise commit message
3. Push to origin to update the PR
4. If any of these steps fail, ask the user for help.`
}

/**
 * Quote a path for safe inclusion in a shell command. Single-quotes preserve
 * everything literally; embedded single-quotes are escaped via the `'\''`
 * trick. Sufficient for the file paths git produces.
 *
 * NOTE: POSIX-only quoting. The output is executed by Claude's Bash tool,
 * which on Windows runs through Git Bash / WSL — a POSIX environment — so
 * single-quote semantics hold. Don't reuse this for native Windows cmd.exe.
 */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}

/**
 * Generates a message for Claude to perform a code review.
 *
 * When `scopedFiles` is provided and non-empty, the prompt narrows Claude to
 * those files only — both via `git diff -- <paths>` and an explicit
 * instruction. This is how the Scoped/All toggle in the Changes panel
 * propagates into the actual review.
 */
export function generateReviewMessage(
  context: PrContext,
  scopedFiles?: string[],
): string {
  const { branch, baseBranch } = context
  const scoped = scopedFiles && scopedFiles.length > 0 ? scopedFiles : null

  const diffCommand = scoped
    ? `git diff origin/${baseBranch}... -- ${scoped.map(shellQuote).join(" ")}`
    : `git diff origin/${baseBranch}...`

  const scopeNote = scoped
    ? `\n\n## Scope\n\nLimit your review to the following files (other changes exist on this branch but are out of scope for this review):\n${scoped.map((f) => `- ${f}`).join("\n")}\n`
    : ""

  return `You are performing a code review on the changes in the current branch.

The current branch is ${branch}, and the target branch is origin/${baseBranch}.${scopeNote}

## Code Review Instructions

When reviewing the diff:
1. **Focus on logic and correctness** - Check for bugs, edge cases, and potential issues.
2. **Consider readability** - Is the code clear and maintainable?
3. **Evaluate performance** - Are there obvious performance concerns?
4. **Assess test coverage** - Are there adequate tests for these changes?

## Getting the Diff

Run \`${diffCommand}\` to get the changes.

## Output Format

Provide:
1. A brief summary of what the changes do
2. A table of issues found with columns: severity (🔴 high, 🟡 medium, 🟢 low), file:line, issue, suggestion
3. If no issues found, state that the code looks good

Keep the review concise and actionable.`
}
