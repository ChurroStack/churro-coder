## Why

Today the desktop app only lets users **point at existing code**: the empty-state page (`select-repo-page.tsx`) offers "Select folder" and "Clone from GitHub", and the in-app `ProjectSelector` popover mirrors those two options. There is no path to **start a new project from scratch** — no way to create a GitHub or Azure DevOps repository, no way to bootstrap a local git project with a sensible skeleton, and no integration with the OpenSpec workflow that the rest of the app revolves around. Users who want a greenfield project must leave the app, create the repo on the provider's website, clone it, then come back — and they still get an empty folder with no AGENTS.md, no `.gitignore`, no OpenSpec scaffolding.

This change introduces a guided **New Project** flow that creates the repository (GitHub or Azure DevOps via their CLIs, or a local git init), clones it into the existing managed location (`~/.churrostack/repos/...`), creates a chat worktree, scaffolds the standard agent files, optionally runs `openspec init`, and hands the user off to a chat in execute mode with their initial prompt pre-filled — all in one wizard.

## What Changes

- **New empty-state and "+ Add Project" entry point.** Replace the two-button `SelectRepoPage` and the popover footer in `ProjectSelector` with a single `NewProjectDialog` that exposes all paths (open existing, clone existing, or create new). Add an explicit "+ Add project" affordance accessible after onboarding (in the `ProjectSelector` popover and the `agents-project-worktree-tab` settings panel) that opens the same dialog. **BREAKING (UI only):** the standalone `SelectRepoPage` is removed; the dialog renders inline on the empty state instead.
- **New "Create new project" wizard**, styled to match the New Workspace UI (numbered `WizardSection` blocks, segmented control for provider, option cards), with a right-side help panel that explains each field with examples (mirrors the user's GitHub-style screenshots).
- **Provider segmented control:** GitHub (default), Azure DevOps, Local. The "Open existing folder" and "Clone existing repo" paths remain accessible as siblings on the dialog (not nested under "Create new").
- **Project name field** with strict validation (provider-safe slug rules, length, reserved-name checks) — the name is reused as the repository name and the on-disk folder name.
- **Description** field (optional, free text; used as the GitHub/Azure repo description).
- **Initialize OpenSpec** toggle (default on if the user has `openspec` available; runs `openspec init` after the worktree exists).
- **Initial prompt** field (required). This becomes the first message in an `execute`-mode chat that runs against the newly created worktree.
- **Provider CLI integration:**
  - **GitHub** uses `gh repo create` (requires `gh` authenticated against the user-selected GitHub organization or personal account).
  - **Azure DevOps** uses `az repos create` (requires `az` + the `azure-devops` extension; user picks the Azure DevOps **organization URL** — e.g. `https://dev.azure.com/contoso` — and **project**).
  - **Local** runs `git init --initial-branch=main` in the target folder, no remote.
  - When a CLI is missing, the wizard surfaces inline **per-OS install instructions** (macOS / Linux / Windows) using existing platform detection (`isMacOS()`, `isWindows()`, `isLinux()`).
- **Provider account / organization picker.** Once the CLI is detected and authenticated, the wizard loads the available accounts/orgs (GitHub: authenticated user + their orgs via `gh api user/orgs`; Azure DevOps: configured organizations via `az devops configure --list` or stored history; project list via `az devops project list`). The user selects where the repo will live.
- **Authentication check before write.** If `gh auth status` / `az account show` fails, the wizard blocks creation and shows an inline "Sign in" step with the exact command to run (`gh auth login`, `az login`) and a "Retry" button.
- **Repo + project scaffolding on creation:**
  - Clone the new remote into `~/.churrostack/repos/<owner>/<repo>` (same root as today's clone flow); for Local, the project lives at `~/.churrostack/repos/local/<slug>` and is `git init`'d there.
  - Create a default branch (`main`) with an initial commit containing: `AGENTS.md` (templated stub pointing at the user's prompt/description and standard agent guidance), `CLAUDE.md` symlink to `AGENTS.md`, `.gitignore` (templated based on minimal sensible defaults), `README.md` (name + description). Templates live under `apps/desktop/resources/new-project-templates/`.
  - Push the initial commit to the remote (skip for Local).
  - If "Initialize OpenSpec" is checked, run `openspec init` in the repo root.
- **Worktree + chat handoff:**
  - Reuse `createWorktreeForChat()` to spin up the first workspace pointing at `main`.
  - Create a `chats` row + `subChats` row in **execute mode** with the user's initial prompt seeded as `pendingExecuteMessageAtom`.
  - Navigate to the new chat so the user lands in execute mode with the prompt about to send.
- **Telemetry / traceability.** New `[NewProject]` log prefix in the main process; `trackProjectOpened` is supplemented with `trackProjectCreated({ provider, openspecInit, hasPrompt })`. CLI invocations log `provider`, `correlationId`, outcome, and compact error.

## Capabilities

### New Capabilities
- `new-project-wizard`: The guided multi-step UI flow for creating a new project (provider selection, name validation, description, OpenSpec toggle, initial prompt, contextual help panel) and the orchestration that turns those inputs into a repository, worktree, scaffolded files, optional OpenSpec init, and an execute-mode chat handoff.
- `provider-cli-integration`: Detection, authentication probing, install guidance, and invocation of `gh` (GitHub) and `az` (Azure DevOps) CLIs from the main process, plus the contract for listing accounts/orgs/projects and creating repos.

### Modified Capabilities
*(none — no existing OpenSpec spec describes the current empty-state or project-add behavior, so this is purely additive at the spec layer; existing UI files are replaced as listed in **Impact** but do not have corresponding specs to delta.)*

## Impact

- **Renderer (new files)**
  - `apps/desktop/src/renderer/features/new-project/new-project-dialog.tsx` — top-level dialog with three tabs (Create / Open / Clone).
  - `apps/desktop/src/renderer/features/new-project/create-project-wizard.tsx` — the wizard form using `WizardSection` blocks.
  - `apps/desktop/src/renderer/features/new-project/help-panel.tsx` — right-side examples/help panel.
  - `apps/desktop/src/renderer/features/new-project/provider-segmented-control.tsx`, `account-org-picker.tsx`, `cli-install-instructions.tsx`, `name-input.tsx` (with validation hook).
  - `apps/desktop/src/renderer/features/new-project/atoms.ts` — `newProjectDialogOpenAtom`, `newProjectDraftAtom`.

- **Renderer (replaced / modified)**
  - `apps/desktop/src/renderer/features/onboarding/select-repo-page.tsx` — replaced by a thin wrapper that renders `NewProjectDialog` inline on the empty state.
  - `apps/desktop/src/renderer/features/agents/components/project-selector.tsx` — popover footer's two buttons replaced with one "+ Add project" that opens the dialog.
  - `apps/desktop/src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab.tsx` — the existing `+` button calls `openFolder` directly today; it now opens the `NewProjectDialog`.
  - `apps/desktop/src/renderer/App.tsx` — routing when `selectedProject === null` renders the empty-state wrapper.

- **Main process (new)**
  - `apps/desktop/src/main/lib/providers/types.ts` — `ProviderAdapter` interface (`detectCli`, `checkAuth`, `listAccounts`, `listProjects?`, `createRepo`).
  - `apps/desktop/src/main/lib/providers/github.ts`, `azure-devops.ts`, `local.ts` — concrete adapters.
  - `apps/desktop/src/main/lib/providers/cli-install.ts` — per-OS install copy/links built on `getCurrentPlatformProvider()`.
  - `apps/desktop/src/main/lib/trpc/routers/new-project.ts` — tRPC router exposing `detectCli`, `checkAuth`, `listAccounts`, `listProjects`, `validateName`, `createProject`.

- **Main process (modified)**
  - `apps/desktop/src/main/lib/trpc/routers/projects.ts` — `cloneFromGitHub` extracted into a shared `cloneIntoRepos(owner, repo, cloneUrl)` helper reused by `new-project.createProject`.
  - `apps/desktop/src/main/lib/trpc/routers/index.ts` — register `newProject` router.
  - `apps/desktop/src/main/lib/openspec/run-openspec-cli.ts` — reused for `openspec init`; no schema change.
  - `apps/desktop/src/main/lib/analytics/index.ts` — add `trackProjectCreated`.

- **Resources**
  - `apps/desktop/resources/new-project-templates/AGENTS.md.tmpl`, `.gitignore.tmpl`, `README.md.tmpl` — templated initial commit content.

- **Database**
  - No schema change. New rows use the existing `projects` table (with `gitProvider = 'github' | 'azure' | null` for Local). The existing `gitProject` column already supports Azure DevOps.

- **Dependencies**
  - No new npm packages. `gh` and `az` are external user-installed CLIs; the app only shells out and provides install guidance when they are missing.

- **Out of scope (non-goals)**
  - Other providers (GitLab, Bitbucket) — they could plug in later via the `ProviderAdapter` interface but are not implemented in this change.
  - Non-CLI-based GitHub/Azure auth (no OAuth flow in-app) — we delegate auth to the CLIs the user already trusts.
  - Importing repository templates from GitHub/Azure (`gh repo create --template`) — the scaffolding is local templates only; provider-side templates can be a follow-up.
  - Renaming or transferring existing repositories.
