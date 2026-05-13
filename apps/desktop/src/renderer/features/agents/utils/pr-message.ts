import { renderBuiltinPrompt } from '../../../../prompts/render';

export interface PrContext {
  branch: string;
  baseBranch: string;
  uncommittedCount: number;
  hasUpstream: boolean;
  /**
   * Git host provider for this workspace. The string variant comes from the
   * tRPC context query (untyped column); the narrowed `"github" | "azure"`
   * variant comes from internal call sites. Null/undefined → treat as GitHub.
   */
  provider?: string | null;
  /** Populated when provider === "azure" so the agent can target the right org/project/repo. */
  azure?: {
    organization: string;
    project: string;
    repository: string;
  };
  /** Populated when the active sub-chat is bound to an OpenSpec change. */
  openspecChange?: {
    name: string;
    path: string;
  };
  /** URL of an existing open PR for the branch, if one is tracked in the DB. */
  existingPrUrl?: string | null;
}

/**
 * Generates a message for Claude to create a PR
 */
export function generatePrMessage(context: PrContext): string {
  return renderBuiltinPrompt('workflow/create-pr', {
    uncommittedCount: context.uncommittedCount,
    branch: context.branch,
    baseBranch: context.baseBranch,
    hasUpstream: context.hasUpstream,
    provider: context.provider ?? null,
    azureOrganization: context.azure?.organization ?? '',
    azureProject: context.azure?.project ?? '',
    azureRepository: context.azure?.repository ?? '',
    openspecChangeName: context.openspecChange?.name ?? '',
    openspecChangePath: context.openspecChange?.path ?? '',
    existingPrUrl: context.existingPrUrl ?? ''
  });
}

/**
 * Generates a message for Claude to commit and push changes to an existing PR
 */
export function generateCommitToPrMessage(context: PrContext): string {
  return renderBuiltinPrompt('workflow/commit-to-pr', {
    branch: context.branch,
    baseBranch: context.baseBranch,
    uncommittedCount: context.uncommittedCount
  });
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
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * Generates a message for Claude to perform a code review.
 *
 * When `scopedFiles` is provided and non-empty, the prompt narrows Claude to
 * those files only — both via `git diff -- <paths>` and an explicit
 * instruction. This is how the Scoped/All toggle in the Changes panel
 * propagates into the actual review.
 */
export function generateReviewMessage(context: PrContext, scopedFiles?: string[]): string {
  const { branch, baseBranch } = context;
  const scoped = scopedFiles && scopedFiles.length > 0 ? scopedFiles : null;

  const diffCommand = scoped
    ? `git diff origin/${baseBranch}... -- ${scoped.map(shellQuote).join(' ')}`
    : `git diff origin/${baseBranch}...`;

  const scopeNote = scoped
    ? `\n\n## Scope\n\nLimit your review to the following files (other changes exist on this branch but are out of scope for this review):\n${scoped.map((f) => `- ${f}`).join('\n')}\n`
    : '';

  return renderBuiltinPrompt('workflow/review', { branch, baseBranch, scopeNote, diffCommand });
}
