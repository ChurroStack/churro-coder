## 1. Scaffold provider adapter layer (main process)

- [x] 1.1 Create `apps/desktop/src/main/lib/providers/types.ts` with the `ProviderAdapter` interface, the discriminated-union result types (`DetectResult`, `AuthResult`, `Account`, `AzureProject`, `CreateRepoInput`, `CreateRepoResult`, `ErrorCode`), and the `correlationId` typing.
- [x] 1.2 Add `apps/desktop/src/main/lib/providers/cli-runner.ts` — a thin wrapper around `execFile` that uses argv arrays, applies `getShellEnvironment()` on macOS/Linux, applies the Windows env via the platform abstraction, enforces a 5 s default timeout, and returns `{ stdout, stderr, code }` instead of throwing.
- [x] 1.3 Add `apps/desktop/src/main/lib/providers/detect-cache.ts` — a per-adapter 60 s cache for `detectCli()` and `checkAuth()` results, with `evict(provider)` exposed for the "Recheck" path.
- [x] 1.4 Implement `apps/desktop/src/main/lib/providers/github.ts` (`detectCli` via `gh --version`, `checkAuth` via `gh auth status`, `listAccounts` via `gh api user` + `gh api user/orgs --paginate`, `createRepo` via `gh repo create <owner>/<name> --private|--public --description <desc>` — note: no `--confirm`; that flag was removed in `gh` 2.x and is not needed since `--private`/`--public` puts `gh` in non-interactive mode automatically, `getCloneUrl` derives `https://github.com/<owner>/<name>.git`). Return discriminated-union results for every expected failure.
- [x] 1.5 Implement `apps/desktop/src/main/lib/providers/azure-devops.ts` (`detectCli` checks both `az --version` and the presence of the `azure-devops` extension via `az extension list --output json`, `checkAuth` via `az account show`, `listAccounts` reads org list from `az devops configure --list` only — **no persistence** per design decision 10a, `listProjects` via `az devops project list --organization https://dev.azure.com/<org>`, `createRepo` via `az repos create --name <name> --organization ... --project ... --output json`). Manually-typed org URLs from the renderer are passed through `--organization` on the same call and are not written to disk.
- [x] 1.6 Implement `apps/desktop/src/main/lib/providers/local.ts` (`detectCli` returns `{ available: true }` unconditionally because `git` is already a hard dependency, `checkAuth` returns `{ ok: true }`, `listAccounts` returns a single synthetic entry `{ id: 'local', label: 'Local only' }`, `createRepo` ensures the target dir exists and runs `git init --initial-branch=main` there; `getCloneUrl` returns `null`).
- [x] 1.7 Add `apps/desktop/src/main/lib/providers/index.ts` with `getProviderAdapter(id)` returning the singleton adapter for the given id and throwing for unknown ids.
- [x] 1.8 Add `apps/desktop/src/main/lib/providers/install-instructions.ts` returning per-OS install copy + primary command + secondary command + docs URL for `gh`, `az`, and the `azure-devops` extension. Use `getCurrentPlatformProvider()` for OS detection.
- [x] 1.9 Wire structured `[Provider:<id>]` logs into every adapter method (entry + exit, `correlationId`, `op`, `ok`, compact `reason` on failure; never log description, prompt, tokens, or full stderr).

## 2. Refactor existing clone path into a shared helper

- [x] 2.1 Extract the **filesystem-only** portion of `projects.cloneFromGitHub` (`apps/desktop/src/main/lib/trpc/routers/projects.ts`) — directory creation + `git clone` — into `cloneIntoRepos({ owner, repo, project?, cloneUrl, providerHint })` in a new `apps/desktop/src/main/lib/git/clone-into-repos.ts`. The helper returns `{ clonePath: string }` and does **not** insert a `projects` row; callers handle their own DB inserts. Preserve the legacy `~/.21st/repos/...` fallback for GitHub URLs.
- [x] 2.2 Update `projects.cloneFromGitHub` to be a thin wrapper around `cloneIntoRepos` (no behavior change visible to existing callers).
- [x] 2.3 Add Azure DevOps URL parsing (`https://dev.azure.com/<org>/<project>/_git/<repo>`) to the clone parser so `Clone existing repository` can accept Azure URLs and route them through `cloneIntoRepos` with `project` set.

## 3. New Project tRPC router (main process)

- [x] 3.1 Create `apps/desktop/src/main/lib/trpc/routers/new-project.ts` with the router skeleton and procedure stubs.
- [x] 3.2 Implement `newProject.detectCli({ provider })` — delegates to the adapter for `'github' | 'azure' | 'local'`; for the special value `'openspec'`, call the existing `assertOpenspecBinAvailable()` from `apps/desktop/src/main/lib/openspec/run-openspec-cli.ts` and return `{ available: true | false }` (no full adapter needed). Result is not cached server-side — renderer React Query handles caching.
- [x] 3.3 Implement `newProject.checkAuth({ provider, evictCache? })` — delegates to the adapter.
- [x] 3.4 Implement `newProject.listAccounts({ provider })` — delegates to `adapter.listAccounts()` and returns the result directly. **No server-side caching** — per design decision 10a, the 5-minute `staleTime` in the renderer's React Query layer is the only cache.
- [x] 3.5 Implement `newProject.listProjects({ provider, accountId })` (returns `null` for GitHub and Local).
- [x] 3.6 Implement `newProject.validateName({ provider, accountId, projectId?, name })` — runs the same regex/reserved-name checks as the renderer plus a `fs.existsSync` check on the target clone path.
- [x] 3.7 Implement `newProject.createProject({ provider, accountId, projectId?, name, description, visibility, openspecInit, prompt })` orchestrating steps in this exact order:
  1. `validateName` (renderer already validated; server re-checks for race conditions)
  2. `adapter.createRepo(...)` → register `deleteRemoteRepo` compensator
  3. `cloneIntoRepos(...)` (or `git init` for Local) → register `removeCloneDir` compensator
  4. Render and write scaffolding templates to the clone root (AGENTS.md, CLAUDE.md, .gitignore, README.md, `.github/copilot-instructions.md`, `.cursor/rules`)
  5. `git add . && git commit -m "Initial commit"` in the clone root
  6. `git push -u origin main` for remote providers (skip for Local); clear `deleteRemoteRepo` compensator on success
  7. Insert `projects` row into the database
  8. Create `chats` row (`projectId` from step 7) + `subChats` row (`mode = 'execute'`)
  9. `createWorktreeForChat(chatId)` → worktree points at `main`
  10. Optional `openspec init` run in the **worktree path** (consistent with `chats.openspecInit`; non-fatal on failure)
  11. Return `{ projectId, chatId, subChatId }`
- [x] 3.8 Implement the rollback compensator stack inside `createProject`: register `removeCloneDir` after a successful clone, register `deleteRemoteRepo` after a successful remote-create (cleared once push completes), execute compensators in reverse order on failure, and surface the failing step + compact reason as the thrown tRPC error.
- [x] 3.9 Register `newProject` in `apps/desktop/src/main/lib/trpc/routers/index.ts` and ensure it is exposed via the preload bridge like the other routers.

## 4. Scaffolding templates

- [x] 4.1 Create `apps/desktop/resources/new-project-templates/AGENTS.md.tmpl` per **design.md decision 6a**: preamble (single source of truth + CLAUDE.md symlink rule + pointer stubs note), Windows symlink note with recovery command, Core Invariants (4 rules), Worktree Discipline, Build & Verification, Traceability, Change Scope, Postmortems convention (`openspec/postmortems/` when OpenSpec is initialized, `docs/postmortems/` otherwise; dated folder per logical change), and a final "What we set out to build" section that embeds `{{name}}`, `{{description}}`, `{{prompt}}`.
- [x] 4.2 Create `apps/desktop/resources/new-project-templates/README.md.tmpl` with `{{name}}` and `{{description}}` placeholders.
- [x] 4.3 Create `apps/desktop/resources/new-project-templates/.gitignore.tmpl` with minimal sensible defaults (`node_modules/`, `dist/`, `build/`, `.env*`, `.DS_Store`, IDE settings folders).
- [x] 4.4 Add a small `renderTemplate(templatePath, vars)` helper in `apps/desktop/src/main/lib/providers/templates.ts` doing literal `{{var}}` substitution (no Jinja-style dependency).
- [x] 4.5 Implement the AGENTS.md / CLAUDE.md write step inside `createProject`: write `AGENTS.md`, then on macOS/Linux create `CLAUDE.md` as a symlink to `AGENTS.md`; on Windows write `CLAUDE.md` as a duplicate file (see design decision 6 + 6a).
- [x] 4.7 Create pointer stub templates `apps/desktop/resources/new-project-templates/copilot-instructions.md.tmpl` (one-line: `See [AGENTS.md](../AGENTS.md) for coding-agent instructions.`) and `apps/desktop/resources/new-project-templates/cursor-rules.tmpl` (same content). In `createProject` step 4 (task 3.7), write these as `.github/copilot-instructions.md` and `.cursor/rules` so the initial commit includes all four pointer files alongside AGENTS.md.
- [x] 4.6 Ensure the templates directory is included in the electron-builder packaged resources (update `package.json` `build.extraResources` if needed so the templates ship in production builds).

## 5. Analytics & tracing

- [x] 5.1 Add `trackProjectCreated({ provider, openspecInit, hasPrompt })` to `apps/desktop/src/main/lib/analytics/index.ts` and call it from `createProject` on success only (never on rollback paths).
- [x] 5.2 Add `[NewProject] <correlationId> step=<name> ok=<bool> reason=<compact>` log lines at each step boundary (validate, cli-detect, auth-check, remote-create, clone, scaffold, commit, push, openspec-init, worktree-create, db-insert, chat-create). Confirm none of them log the prompt, description, or tokens.

## 6. Renderer — atoms and shared form state

- [x] 6.1 Create `apps/desktop/src/renderer/features/new-project/atoms.ts` with `newProjectDialogOpenAtom`, `newProjectActiveSectionAtom` (`'create' | 'open' | 'clone'`), `newProjectDraftAtom` (provider, accountId, projectId, name, description, visibility, openspecInit, prompt, correlationId), and `newProjectProgressAtom` (per-step status + last error).
- [x] 6.2 Add a `useResetNewProjectDraft()` hook that resets the draft when the dialog closes successfully.

## 7. Renderer — Create section UI

- [x] 7.1 Create `apps/desktop/src/renderer/features/new-project/create-project-wizard.tsx` rendering `WizardSection` blocks: Provider, Account/Org, (Project, Azure only), Name, Description, (Public checkbox, GitHub only — per design decision 10b), OpenSpec toggle, Initial prompt. Use `max-w-5xl` and the tighter `rounded-md` per `apps/desktop/CLAUDE.md`.
- [x] 7.2 Create `apps/desktop/src/renderer/features/new-project/provider-segmented-control.tsx` rendering the GitHub / Azure DevOps / Local segments. GitHub is the default selection.
- [x] 7.3 Create `apps/desktop/src/renderer/features/new-project/account-org-picker.tsx` with two sub-modes: GitHub combobox listing accounts (badge "Personal" for the authenticated user), Azure DevOps combobox + manual URL entry (manually-typed org URLs are session-only — never written to disk, per design decision 10a). Wire to `trpc.newProject.listAccounts.useQuery` with `staleTime: 5 * 60 * 1000` and a "Refresh" button that calls `utils.newProject.listAccounts.invalidate()`.
- [x] 7.4 Create `apps/desktop/src/renderer/features/new-project/azure-project-picker.tsx` populated by `trpc.newProject.listProjects.useQuery({ accountId })` with `staleTime: 5 * 60 * 1000` and a "Refresh" button that calls `utils.newProject.listProjects.invalidate({ accountId })`.
- [x] 7.5 Create `apps/desktop/src/renderer/features/new-project/name-input.tsx` running the synchronous regex/reserved-name validation in `apps/desktop/src/renderer/features/new-project/lib/validate-name.ts`, plus a debounced `trpc.newProject.validateName.useQuery` for the target-exists check. Surface inline errors below the input.
- [x] 7.6 Create `apps/desktop/src/renderer/features/new-project/cli-install-instructions.tsx` rendering the per-OS block when `detectCli` returns unavailable; include "Copy" buttons and a **Recheck** button that (a) calls `trpc.newProject.detectCli` with `{ provider, evictCache: true }` to drop the main-process 60 s cache and (b) calls `utils.newProject.detectCli.invalidate({ provider })` to invalidate React Query. Render an in-flight spinner on the button until the new probe resolves.
- [x] 7.7 Create `apps/desktop/src/renderer/features/new-project/auth-required-panel.tsx` shown when `checkAuth` returns `not-authenticated`; surface the exact sign-in command (`gh auth login` / `az login` / `az login --use-device-code` when hinted) plus a **Retry** button that calls `utils.newProject.checkAuth.invalidate({ provider })`. Render an in-flight spinner on the button until the new probe resolves.
- [x] 7.8 Create `apps/desktop/src/renderer/features/new-project/help-panel.tsx` — right-side context panel keyed by the currently focused field with 1–3 examples per field (Name, Description, OpenSpec, Initial prompt).
- [x] 7.9 Create `apps/desktop/src/renderer/features/new-project/openspec-init-toggle.tsx`. Wire `trpc.newProject.detectCli.useQuery({ provider: 'openspec' })` (task 3.2 handles this special provider by calling `assertOpenspecBinAvailable()`). When response is `{ available: false }`: render the toggle disabled and unchecked with an inline hint linking to the OpenSpec install docs. Include a **Recheck** button that evicts the cache and re-queries.
- [x] 7.10 Create `apps/desktop/src/renderer/features/new-project/visibility-checkbox.tsx`: a single "Public" checkbox rendered only when the GitHub provider is selected, unchecked by default. Sets `draft.visibility = 'public'` when checked; leaves it `undefined` otherwise. Hidden for Azure DevOps and Local.
- [x] 7.11 Add the initial-prompt textarea with required-min-10-chars validation and 4000-char counter.
- [x] 7.12 Implement the submit handler: gather draft, call `trpc.newProject.createProject.useMutation`, on success navigate to the returned chat, set `selectedProjectAtom`, set `selectedAgentChatIdAtom`, seed the chat's `pendingExecuteMessageAtom` with the prompt, focus the chat input, and close the dialog.
- [x] 7.13 Implement the in-dialog progress view shown while the mutation is in-flight: ordered list of steps with spinner / check / error icons, an inline "Cancel" button that aborts (best-effort) and triggers rollback by NOT awaiting the mutation but signaling abort via a `correlationId`-keyed cancellation channel (simplest viable cancellation: stop the renderer from awaiting and let server compensators run to completion).

## 8. Renderer — Open and Clone sections

- [x] 8.1 Create `apps/desktop/src/renderer/features/new-project/open-folder-section.tsx` wrapping today's `projects.openFolder` mutation. No behavior change.
- [x] 8.2 Create `apps/desktop/src/renderer/features/new-project/clone-repo-section.tsx` accepting both GitHub (`owner/repo`, `https://github.com/...`, SSH) and Azure DevOps (`https://dev.azure.com/<org>/<project>/_git/<repo>`) inputs, routed through `projects.cloneFromGitHub` (now backed by `cloneIntoRepos`). Show inline parse errors.

## 9. Renderer — Dialog container and entry points

- [x] 9.1 Create `apps/desktop/src/renderer/features/new-project/new-project-dialog.tsx` — Radix Dialog with a segmented top control switching between Create / Open / Clone, the chosen section's content, and the help panel. Respect `WebkitAppRegion: 'no-drag'` on interactive children.
- [x] 9.2 Create `apps/desktop/src/renderer/features/new-project/empty-state-shell.tsx` — full-screen container that renders `NewProjectDialog` inline (no modal overlay) for the "no project selected" case.
- [x] 9.3 Update `apps/desktop/src/renderer/App.tsx` routing to render `EmptyStateShell` instead of `SelectRepoPage` when `selectedProject === null` (and remove the now-unused `SelectRepoPage` import).
- [x] 9.4 Delete `apps/desktop/src/renderer/features/onboarding/select-repo-page.tsx`.
- [x] 9.5 Replace the popover footer in `apps/desktop/src/renderer/features/agents/components/project-selector.tsx`: remove "Add repository" and "Add from GitHub" buttons, add a single "+ Add project" button that opens `NewProjectDialog` via `newProjectDialogOpenAtom`.
- [x] 9.6 Update the "+" button in `apps/desktop/src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab.tsx` to open `NewProjectDialog` instead of calling `openFolder` directly.

## 10. Tests

- [x] 10.1 Add `validate-name.test.ts` covering the regex, reserved names, dot rules, length cap, and casing edge cases.
- [x] 10.2 Add `cloneIntoRepos.test.ts` covering: GitHub new clone, GitHub legacy `~/.21st/repos/...` fallback, Azure DevOps clone with `project` segment.
- [x] 10.3 Add adapter unit tests using a mocked `cli-runner.ts` covering: GitHub detect/auth/listAccounts/createRepo (success + name-conflict + not-authenticated), Azure detect with missing extension, Local init.
- [x] 10.4 Add a `new-project-router.test.ts` integration-style test using the existing tRPC test scaffolding that drives `createProject` end-to-end with mocked adapters, mocked git operations, and a temp filesystem; cover the happy path and the push-failure rollback case.
- [x] 10.5 Add a renderer component test for `name-input.tsx` (renders error states for invalid char, reserved name, debounced server check) using the existing `test-utils/` helpers.
- [x] 10.6 Add a renderer component test for `new-project-dialog.tsx` confirming all three sections render, the segmented control swaps content without losing common fields, and the "+ Add project" entry points open the dialog with the Create section active.
- [x] 10.7 Add renderer component tests for the Refresh / Recheck / Retry controls: (a) clicking "Refresh" on the account picker calls `utils.newProject.listAccounts.invalidate`; (b) clicking "Refresh" on the project picker calls `utils.newProject.listProjects.invalidate`; (c) clicking "Recheck" on the CLI install panel calls `detectCli` with `{ evictCache: true }` and then invalidates the query; (d) clicking "Retry" on the auth panel calls `checkAuth` invalidation. Use `createMockTrpc` from `test-utils/`.
- [x] 10.8 Add a renderer component test for `visibility-checkbox.tsx`: renders when provider = 'github', is hidden when provider = 'azure' or 'local', sets `draft.visibility = 'public'` when checked, sets it to `undefined` when unchecked.
- [x] 10.9 Add `assertRegisteredWorktree` coverage to `new-project.test.ts` ✓: after `createProject`, call `assertRegisteredWorktree` with the persisted worktreePath against a mock DB configured to return a matching chat row. Note: a full real-SQLite integration test is not feasible here — `better-sqlite3` is compiled for Electron's Node.js ABI 145 while the test runner uses ABI 141; the two cannot share the same native binary without rebuilding.

## 11. Manual verification

- [ ] 11.1 On macOS: install both `gh` and `az` + `azure-devops` extension; verify Create flow for GitHub (private repo), GitHub (public repo), Azure DevOps, and Local. Confirm AGENTS.md / CLAUDE.md symlink / .gitignore / README appear in the initial commit on the remote.
- [ ] 11.2 On macOS: uninstall `gh` and confirm the install instructions appear with the correct copy and the "Recheck" path picks up after reinstall. Repeat for `az`.
- [ ] 11.3 On macOS: sign out of `gh` (`gh auth logout`) and confirm the auth panel appears with the correct command; sign back in and confirm "Retry" succeeds.
- [ ] 11.4 On macOS: confirm submit handoff lands in an execute-mode chat with the prompt pre-filled and the input focused.
- [ ] 11.5 Windows smoke (or VM): confirm CLAUDE.md is written as a copy not a symlink, and `gh`/`az` install instructions show the winget/choco snippets.
- [ ] 11.6 Linux smoke (or VM): confirm `az login --use-device-code` hint appears when CLI stderr indicates device code is needed.
- [ ] 11.7 Verify that the existing `Open folder` and `Clone existing repository` flows still produce identical `projects` rows compared to pre-change behavior (use the dev DB to spot-check a row before and after).

## 12. Documentation

- [x] 12.1 Update `apps/desktop/AGENTS.md` "Shared UI Decisions" / "Gotchas" with a short note about the New Project dialog and the rule that it is the single entry point for adding projects.
- [x] 12.2 If the templated AGENTS.md includes a Windows note, double-check the wording matches the symlink behavior described in this design.
