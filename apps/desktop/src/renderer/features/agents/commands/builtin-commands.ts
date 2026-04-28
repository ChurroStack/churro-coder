import type { BuiltinCommandAction, SlashCommandOption } from "./types"

/**
 * Prompt texts for prompt-based slash commands
 */
export const COMMAND_PROMPTS: Partial<
  Record<BuiltinCommandAction["type"], string>
> = {
  review:
    "Please review the code in the current context and provide feedback on code quality, potential bugs, and improvements.",
  "release-notes":
    "Generate release notes summarizing the changes in this codebase.",
  "security-review":
    "Perform a security audit of the code in the current context. Identify vulnerabilities, security risks, and suggest fixes.",
  commit:
    "Закоммить это аккуратно, не трогая больше ничего. Сделай коммит только для staged изменений, не добавляй никакие другие файлы и не вноси дополнительных изменений.",
  init:
    "Initialize this project by creating a CLAUDE.md file that documents the codebase architecture, key commands, and conventions for AI assistants. Analyze the repo structure and existing config files first.",
  simplify:
    "Review the code in the current context for reuse, quality, and efficiency. Look for duplicated logic, unnecessary abstractions, dead code, and premature complexity. Propose concrete simplifications and apply them.",
  "scripts-fill": `Populate the "scripts" array in .cscode/worktree.json so the Scripts widget can run common project commands.

Steps:
1. Detect the project type by scanning the repo root and (if applicable) workspace packages:
   - Node/TS: every package.json (root + monorepo packages). Read the "scripts" field of each and surface the most useful ones (dev, build, start, test, lint, typecheck). Use the project's package manager based on the lockfile (bun.lockb -> bun, pnpm-lock.yaml -> pnpm, yarn.lock -> yarn, package-lock.json -> npm).
   - .NET: any *.csproj or *.sln -> "dotnet run", "dotnet build", "dotnet test".
   - Rust: Cargo.toml -> "cargo run", "cargo build", "cargo test".
   - Go: go.mod -> "go run ./...", "go build ./...", "go test ./...".
   - Python: pyproject.toml / poetry / uv / pipenv -> the appropriate run/test commands.
   - Mix only what makes sense; prefer high-value commands (dev / build / test / lint / typecheck) over surfacing every script in the repo.
2. Read the existing .cscode/worktree.json (it may already have setup-worktree). MERGE: do not delete other top-level keys.
3. Write back .cscode/worktree.json with a "scripts" array of objects: { "name": <short slug>, "command": <shell command> }.

Constraints:
- "name" must be unique within the array, lowercase, kebab-case (e.g. "dev", "build", "test", "lint-web").
- "command" runs from the worktree root. Do not include "cd ..." prefixes.
- Pick commands that work cross-platform when possible. No platform variants.
- Cap at ~8 entries to avoid clutter — surface the most useful ones.

Example for a bun monorepo:
{
  "scripts": [
    { "name": "dev",       "command": "bun run dev" },
    { "name": "build",     "command": "bun run build" },
    { "name": "test",      "command": "bun test" },
    { "name": "typecheck", "command": "bun run typecheck" }
  ]
}

Now analyze this project and update .cscode/worktree.json with the appropriate scripts array.`,
  "worktree-setup": `Create a worktree setup script for this project.

Your task:
1. Analyze the project to understand what's needed to set up a working copy
2. Create the file .cscode/worktree.json with setup commands

The goal is to reproduce the EXACT same working state as the original repo in the new worktree.

Rules:
- Use only "setup-worktree" key (works on all platforms)
- Install dependencies using the project's package manager (check for bun.lockb, pnpm-lock.yaml, yarn.lock, package-lock.json)
- Copy ALL real env files that exist (.env, .env.local, .env.development, etc) - NOT example files
- Use $ROOT_WORKTREE_PATH to reference the main repo path
- Don't include build steps unless absolutely necessary for the project to work

Example output for .cscode/worktree.json:
{
  "setup-worktree": [
    "bun install",
    "cp $ROOT_WORKTREE_PATH/.env .env",
    "cp $ROOT_WORKTREE_PATH/.env.local .env.local"
  ]
}

Now analyze this project and create .cscode/worktree.json with the appropriate setup commands.`,
}

/**
 * Check if a command is a prompt-based command
 */
export function isPromptCommand(
  type: BuiltinCommandAction["type"],
): type is "review" | "release-notes" | "security-review" | "commit" | "worktree-setup" | "scripts-fill" | "init" | "simplify" {
  return type in COMMAND_PROMPTS
}

/**
 * Built-in slash commands that are handled client-side
 */
export const BUILTIN_SLASH_COMMANDS: SlashCommandOption[] = [
  {
    id: "builtin:clear",
    name: "clear",
    command: "/clear",
    description: "Start a new conversation (creates new sub-chat)",
    category: "builtin",
  },
  {
    id: "builtin:plan",
    name: "plan",
    command: "/plan",
    description: "Switch to Plan mode (creates plan before making changes)",
    category: "builtin",
  },
  {
    id: "builtin:agent",
    name: "agent",
    command: "/agent",
    description: "Switch to Agent mode (applies changes directly)",
    category: "builtin",
  },
  {
    id: "builtin:compact",
    name: "compact",
    command: "/compact",
    description: "Compact conversation context to reduce token usage",
    category: "builtin",
  },
  {
    id: "builtin:help",
    name: "help",
    command: "/help",
    description: "List all available slash commands",
    category: "builtin",
  },
  // Prompt-based commands
  {
    id: "builtin:review",
    name: "review",
    command: "/review",
    description: "Ask agent to review your code",
    category: "builtin",
  },
  {
    id: "builtin:release-notes",
    name: "release-notes",
    command: "/release-notes",
    description: "Ask agent to generate release notes",
    category: "builtin",
  },
  {
    id: "builtin:security-review",
    name: "security-review",
    command: "/security-review",
    description: "Ask agent to perform a security audit",
    category: "builtin",
  },
  {
    id: "builtin:commit",
    name: "commit",
    command: "/commit",
    description: "Commit staged changes carefully without touching anything else",
    category: "builtin",
  },
  {
    id: "builtin:worktree-setup",
    name: "worktree-setup",
    command: "/worktree-setup",
    description: "Generate worktree setup config with AI",
    category: "builtin",
  },
  {
    id: "builtin:scripts-fill",
    name: "scripts-fill",
    command: "/scripts-fill",
    description: "Generate runnable scripts for the Scripts widget",
    category: "builtin",
  },
  {
    id: "builtin:init",
    name: "init",
    command: "/init",
    description: "Initialize a CLAUDE.md project guide",
    category: "builtin",
  },
  {
    id: "builtin:simplify",
    name: "simplify",
    command: "/simplify",
    description: "Review code for reuse, quality, and efficiency",
    category: "builtin",
  },
]

/**
 * Filter builtin commands by search text
 */
export function filterBuiltinCommands(
  searchText: string,
): SlashCommandOption[] {
  if (!searchText) return BUILTIN_SLASH_COMMANDS

  const query = searchText.toLowerCase()
  return BUILTIN_SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query),
  )
}
