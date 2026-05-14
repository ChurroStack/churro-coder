## Context

The current "add project" surface in the desktop app is intentionally minimal: two buttons on the empty-state page (`apps/desktop/src/renderer/features/onboarding/select-repo-page.tsx`) and a near-identical footer on the in-app `ProjectSelector` popover (`apps/desktop/src/renderer/features/agents/components/project-selector.tsx`). Both flows only accept **already-existing** code: a local folder via `dialog.showOpenDialog` or a GitHub URL via `git clone`. The settings → Projects tab has a `+` button that also just calls `openFolder` inline.

Other relevant facts about the existing system:
- **Managed clone root:** `projects.cloneFromGitHub` clones into `~/.churrostack/repos/<owner>/<repo>` (with a legacy `~/.21st/repos/...` fallback). No project-level "default clone root" setting exists; the path is hardcoded.
- **Worktrees:** `createWorktree()` and `createWorktreeForChat()` in `apps/desktop/src/main/lib/git/worktree.ts` already encapsulate `git worktree add` + LFS + lock-file handling. Worktree paths live at `~/.churrostack/worktrees/<projectSlug>/<workspaceName>`.
- **OpenSpec hooks:** `chats.openspecInit` already wraps `openspec init` (with `assertOpenspecBinAvailable` + `detectOpenspecState`). New projects don't auto-initialize today.
- **Provider awareness:** the `projects` table already has `gitProvider` with `'github' | 'gitlab' | 'bitbucket' | 'azure' | null` and an Azure-specific `gitProject` column — the schema is ready for Azure DevOps.
- **CLI shelling:** no provider-CLI integration exists yet. `getShellEnvironment()` (`apps/desktop/src/main/lib/git/shell-env.ts`) is the canonical way to pick up PATH on macOS/Linux; the platform abstraction (`apps/desktop/src/main/lib/platform/index.ts`) covers `isMacOS()`, `isWindows()`, `isLinux()` and CLI install path conventions.
- **UI primitives we should reuse:** `WizardSection`, `RadioCardGroup`, the segmented-control pattern (see `agent-mode-selector.tsx`), and the `max-w-5xl` content width called out in `apps/desktop/CLAUDE.md`. The DESIGN.md note specifically warns against `rounded-2xl/3xl` shells and oversized cards for this surface.

Constraints:
- All renderer ↔ main communication is tRPC, validated with zod.
- No new npm dependencies; `gh` and `az` are user-installed external CLIs.
- Logs must avoid secrets (auth tokens, prompts, full stderr — per AGENTS.md "Traceability").
- Drag regions in the frameless window mean any interactive control under the title bar needs `WebkitAppRegion: 'no-drag'`.

## Goals / Non-Goals

**Goals:**
- Replace the two-button empty state with a single guided dialog that covers create / open / clone.
- Make "create a new project from scratch" the default, with GitHub as the default provider.
- Wrap `gh` and `az` (with the `azure-devops` extension) behind a small `ProviderAdapter` interface so the rest of the app stays provider-agnostic.
- Provide first-class per-OS install guidance when the required CLI is missing.
- Seed the new project with sensible scaffolding (AGENTS.md + CLAUDE.md + .gitignore + README.md) and optionally `openspec init`.
- Hand off to an execute-mode chat with the user's prompt pre-filled so the very first interaction is productive.
- Keep the change additive at the DB layer (reuse the existing `projects` schema).

**Non-Goals:**
- GitLab and Bitbucket provider adapters (the interface should accommodate them but no implementation in this change).
- In-app OAuth for GitHub or Azure (we delegate auth to the user-installed CLI tools).
- Provider-side templates (`gh repo create --template`) or import flows.
- Persisting a user-configurable "clone root" setting — we keep `~/.churrostack/repos/...` hardcoded for now.
- Bulk project import or migration of legacy `~/.21st/repos/...` clones beyond the existing read-only fallback.

## Decisions

### 1. One dialog, three sibling sections — not three separate dialogs

`NewProjectDialog` is a single modal with three top-level sections: **Create new project** (default), **Open existing folder**, **Clone existing repository**. They are surfaced as a segmented control across the top of the dialog (matching the New Workspace mode chooser style). The dialog is rendered inline on the empty-state shell and as a modal everywhere else.

*Alternatives considered:* three independent flows (one route per path). Rejected because users routinely conflate "I have a folder" and "I want to clone": forcing them to choose at the entry point creates dead-end UX. A single modal also keeps the "+ Add project" affordance trivially discoverable.

### 2. Provider adapter pattern with discriminated-union results

The main process introduces `ProviderAdapter` (`apps/desktop/src/main/lib/providers/types.ts`) with concrete adapters for GitHub (`github.ts`), Azure DevOps (`azure-devops.ts`), and Local (`local.ts`). All methods return `{ ok: true, ... } | { ok: false, code, message }` for expected failures (missing CLI, not authenticated, name conflict, target exists). Only programmer errors throw.

*Why:* the dialog state machine needs to render specific inline UI per failure mode (install instructions vs. sign-in panel vs. field-level error). Exceptions would force the renderer to parse error messages; a discriminated union forces both the adapter and the consumer to enumerate every case.

*Alternatives considered:* throw with typed error classes (`MissingCliError`, `NotAuthenticatedError`, ...). Rejected — tRPC error serialization loses the type, and the catch-block style hides the exhaustive set of cases the UI must handle.

### 3. CLI invocations use `execFile` with argv arrays, never shell strings

Both adapters spawn the CLI via `execFile` (or `spawn`) with the command name and an array of arguments. Descriptions, names, and URLs that come from the user never get interpolated into a shell string.

*Why:* a user-supplied description like `$(rm -rf /)` could be catastrophic if passed through `exec(...)`. Today's `cloneFromGitHub` uses `execAsync` with template-string concatenation — acceptable because the args are already validated owner/repo slugs, but the new wizard accepts free-text descriptions, so we tighten the contract.

### 4. CLI detection is cached for 60s with a "Recheck" escape hatch

`detectCli()` results are memoized per adapter id for 60 seconds. The cached result includes negative outcomes (`{ available: false }`) so the wizard does not re-probe on every keystroke. The install-instructions UI exposes a "Recheck" button that evicts the cache.

*Why:* the empty-state and the popover entry both mount the dialog cold; without caching, a fresh open issues a `gh --version` + `az --version` + `az extension list` + `openspec --version` flurry. 60 seconds is enough to feel snappy without making "I just installed gh" require restarting the app.

### 5. Initial commit + push happens before chat handoff

The wizard pushes the initial commit (templated AGENTS.md / CLAUDE.md / .gitignore / README.md) **before** creating the worktree and chat. This means the user's first execute-mode message lands on a worktree branched off a `main` that already has a sane skeleton.

*Why:* execute-mode chats expect a working tree they can `git diff` against. If we hand off before the initial commit, the agent's first tool call is "what is this empty repo?" — bad first impression. The push order also means that if push fails (auth, network), we fail loudly *before* the user has invested effort in the chat.

*Trade-off:* the user waits longer for the dialog to close (clone + commit + push + openspec + worktree + chat create can take 10–30 s). We mitigate with per-step progress indicators in the dialog (see decision 7).

### 6. CLAUDE.md is a symlink on macOS/Linux, a copy on Windows

The repo convention (per the root AGENTS.md) is `CLAUDE.md → AGENTS.md` via git symlink. On Windows we fall back to writing a duplicate file because git symlinks require Developer Mode + `core.symlinks=true`.

*Why:* matching the repo's own convention. The Windows fallback is honest about the constraint rather than failing silently.

*Trade-off:* Windows users who later commit edits to `AGENTS.md` won't have them mirrored in `CLAUDE.md`. The templated AGENTS.md will include a top-of-file note ("On Windows this file may be a copy of AGENTS.md — edit AGENTS.md and copy here, or enable git symlinks.") to make the asymmetry visible.

### 6a. AGENTS.md template content is generic, adapted from agents.md

The templated `AGENTS.md.tmpl` follows the structure of the [agents.md](https://agents.md/) community convention but is **not project-specific** — it ships with the desktop app and is rendered identically for every new project (with only `{{name}}`, `{{description}}`, and `{{prompt}}` substituted). The template explicitly carries the same core invariants and discipline rules that the user's own teams have found valuable, so brand-new projects start aligned with the conventions used by the rest of the repository ecosystem.

The rendered file SHALL contain, in order:

1. **Preamble** — one paragraph stating that `AGENTS.md` is the single source of truth for AI coding agents (Claude Code, Codex, Cursor, Aider, Copilot, …); `CLAUDE.md` is a symlink (Windows: a copy) and must never be edited directly; other tools that need their own discovery file get small pointer stubs under `.github/` and `.cursor/` that defer here.
2. **Windows symlink note** — short callout explaining that git symlinks may need `core.symlinks=true` and Developer Mode, with the recovery command (`git config core.symlinks true && git checkout -- CLAUDE.md`).
3. **Core Invariants** — the four rules verbatim in spirit (simplified wording):
   - Don't assume; surface tradeoffs.
   - Minimum code that solves the problem.
   - Touch only what you must.
   - Define success criteria; loop until verified.
4. **Worktree Discipline** — two bullets: always verify `pwd` before editing; stop and ask if a worktree path looks missing or stale.
5. **Build & Verification** — run builds synchronously; run typecheck/build after multi-file edits before declaring done.
6. **Traceability** — add trace info at process boundaries, external tool calls, persistence operations, and error branches; include correlation IDs; never log secrets, full prompts, or large payloads.
7. **Change Scope** — prefer the simplest fix; honor "one-line fix" literally.
8. **Postmortems** — document every issue or bugfix that the OpenSpec workflow does **not** already cover under `openspec/postmortems/` when OpenSpec is initialized, or `docs/postmortems/` otherwise. Folders are dated and descriptively named (e.g., `2026-05-04-fix-<short-slug>/`) and contain a short markdown summary covering trigger, root cause, fix, and verification steps, plus any DB scripts or other artifacts the fix required. One folder per logical change.
9. **Initial intent (templated)** — a final section that quotes `{{prompt}}` under a "What we set out to build" heading, with `{{name}}` and `{{description}}` echoed above it. This is the only section that varies per project.

*Why:* the user's existing AGENTS.md across their teams encodes hard-won discipline (the four invariants, the postmortems convention) that they want every new project to start with. Hard-coding the structure into the template removes the need to maintain a separate "blank" AGENTS.md and ensures consistency. The trade-off is that updating the template requires a desktop app release; we accept this because the file is meant to be edited freely once a project is created — the template is a starting point, not a runtime convention.

*Alternatives considered:* (a) a minimal AGENTS.md that just says "edit me" — rejected because new agent-driven projects benefit most from these rules being present from day one; (b) downloading the template from a remote URL at create-time — rejected because the desktop app prioritizes offline-first, and a template fetch failure should not block project creation.

*Cascade note:* the spec already requires that `AGENTS.md` is rendered from `AGENTS.md.tmpl` with `{{name}}`, `{{description}}`, `{{prompt}}` substituted and that the user's prompt is embedded — that contract is unchanged. Only the template's body content is specified here in the design, and **task 4.1** is updated to reference this decision.

### 7. Wizard is a single page with progress indicators, not a multi-step wizard

Despite the "wizard" naming, the form is rendered as a single scrollable page using `WizardSection` blocks (numbered, with the help-panel on the right). The provider segmented control swaps which subsections appear (e.g., "Account/Org" + "Project" for Azure DevOps; just "Account" for GitHub; neither for Local). On submit, the page transitions to a **progress view** showing each step (create remote, clone, scaffold, commit, push, openspec init, worktree, chat) with a live status indicator.

*Why:* multi-step wizards force the user to re-orient on every Next click; a single page with a side-panel mirrors the New Workspace surface and matches the user's reference screenshots (which show GitHub's "Create a new repository" as a single page with optional help affordances).

*Alternatives considered:* multi-step wizard with one section per page. Rejected for inconsistency with the New Workspace UI and the constraints called out in `apps/desktop/CLAUDE.md` ("Keep the new-workspace hero compact"; segmented control with detail panel below).

### 8. Failure rollback is best-effort, not transactional

Project creation touches the remote, the filesystem, and the database in that order. A true distributed transaction is impossible (we cannot atomically undo a `git push`). Instead the orchestrator records compensating actions per step and runs them in reverse on the first failure:
- After remote-create succeeds: register `deleteRemoteRepo` (only run if no successful push has happened yet).
- After clone succeeds: register `removeCloneDir`.
- After db-insert: no rollback registered — by this point the user has a working repo and worktree on disk, so we keep them and report partial failure.

`openspec init` failure is explicitly non-fatal: by the time it runs, the user already has a functioning project and chat. We warn but proceed.

*Trade-off:* if `gh repo delete` itself fails during rollback (e.g., the user's token does not have `delete_repo` scope), the user is left with a stranded empty remote. The error message tells them what was created and how to clean it up.

### 9. Renderer uses zod-validated tRPC, mirrors existing patterns

`newProject` router lives at `apps/desktop/src/main/lib/trpc/routers/new-project.ts` and follows the structure of `projects.ts` and `chats.ts`. The renderer uses `trpc.newProject.*.useQuery / useMutation` from `apps/desktop/src/renderer/lib/trpc`. Form state lives in jotai atoms under `apps/desktop/src/renderer/features/new-project/atoms.ts`; the dialog's open state is `newProjectDialogOpenAtom`.

*Why:* this codebase has very consistent state/IPC conventions; deviating from them creates review friction with no upside.

### 10a. Account / org / project lists are cached only via React Query — no persistence

The `listAccounts` and `listProjects` results SHALL be cached on the renderer side via tRPC's TanStack Query (React Query) integration with `staleTime: 5 * 60 * 1000` (5 minutes) and the default `gcTime`. A **Refresh** button on each picker SHALL call `utils.newProject.listAccounts.invalidate()` / `utils.newProject.listProjects.invalidate({ accountId })` to bypass the cache on demand. Manually-typed Azure DevOps organization URLs SHALL be valid for the **current** submission only — they are passed via `--organization https://dev.azure.com/<org>` to subsequent `az` calls — and SHALL NOT be persisted by the desktop app in any form (no JSON file, no Drizzle table, no main-process Map).

*Why:* the canonical source for the orgs a user has configured is `az devops configure --list` plus what `az` itself remembers. Maintaining a parallel desktop-app store would require us to handle invalidation, migration, and corruption recovery for no observable benefit over hitting the CLI. tRPC's React Query layer already handles renderer-side caching cleanly with stale-while-revalidate semantics and is the cache pattern used everywhere else in the renderer — so this is also the path of least surprise for reviewers. If the user wants an Azure DevOps org to be remembered across app restarts they can do `az devops configure --defaults organization=https://dev.azure.com/<org>` in their own terminal; the next CLI probe picks it up automatically.

*Alternatives considered:* (a) a JSON history file under `app.getPath('userData')` — rejected per this decision; (b) a `provider_org_history` Drizzle table — heavier still; (c) main-process `Map` cache layered on top of React Query — redundant given the renderer cache and the cheap CLI probe.

*Trade-off:* a manually-typed Azure org URL disappears from the combobox after the 5-minute `staleTime` expires or when the renderer reloads. Users either re-type or pin via `az devops configure --defaults`. We accept this because the same "configure via the CLI in your terminal" workflow already governs authentication (`az login`).

*General principle (applies to every React Query–cached datum in this flow):* every cached list or probe SHALL expose a visible user-invokable control that invalidates the underlying query and triggers a re-fetch. Concretely:
- `listAccounts` and `listProjects` → **Refresh** button on the picker, calling `utils.newProject.<query>.invalidate(...)`.
- `detectCli` (per provider, also cached for 60 s in main-process memory per Decision 4) → **Recheck** button on the install-instructions panel, which both evicts the main-process cache and calls `utils.newProject.detectCli.invalidate({ provider })`.
- `checkAuth` → **Retry** button on the auth-required panel, which calls `utils.newProject.checkAuth.invalidate({ provider })` after the user runs the sign-in command in their terminal.
- `validateName` is debounced per keystroke and is exempt — the user's next edit naturally re-triggers it.

The control SHALL be visually adjacent to the cached data (in the same `WizardSection`), labeled with a clear verb (Refresh / Recheck / Retry — pick the one already used for that surface), and SHALL show a spinner state while the new query is in flight.

### 10b. GitHub repository visibility is a "Public" checkbox, default unchecked

The wizard SHALL render a single "Public" checkbox under the Description field when the GitHub provider is selected. The checkbox is **unchecked by default** (private is the safer first choice for a new project). When checked, the renderer SHALL pass `visibility: 'public'` to `createProject`; when unchecked, the renderer SHALL omit the field and the GitHub adapter SHALL pass `--private` to `gh repo create`. The checkbox SHALL NOT be rendered for the Azure DevOps provider (DevOps repo visibility inherits from the parent project's visibility, which is set in the Azure UI, not via `az repos create`) or the Local provider (no remote).

*Why:* matches GitHub's own "Create repository" UI, keeps the field count low (one checkbox, not a segmented control), and resolves the previous Open Question. Defaulting to private prevents accidental public exposure of greenfield code.

*Trade-off:* if the user attempts to create a public repo in an organization where they lack permission, the failure surfaces only after submit — we let the provider emit the authoritative error rather than pre-flight-checking permissions (Decision 8 already covers post-submit rollback for this class of failure).

### 10. Telemetry is opt-in to existing analytics, not new

We add a single `trackProjectCreated({ provider, openspecInit, hasPrompt })` call alongside the existing `trackProjectOpened` call. No prompt content, no description, no name leaves the device. This respects the privacy posture documented in `apps/desktop/CLAUDE.md`.

## Risks / Trade-offs

- **[CLI version drift]** `gh` and `az` CLIs change argument shapes across major versions (e.g., `gh repo create` removed `--confirm` in some recent versions). → Mitigation: pin our argv to the documented stable surface; surface the CLI's stderr first line on failure so users see the exact problem; in `detectCli()` capture the version and add a warning banner when below a known-good minimum (`gh >= 2.0`, `az >= 2.40` + `azure-devops` extension).

- **[Azure DevOps auth is finicky]** `az login` opens a browser; on headless Linux it requires `az login --use-device-code`. → Mitigation: `checkAuth()` returns a hint string when stderr indicates device-code is required; the inline sign-in panel surfaces the exact command for the user's environment.

- **[Provider rate limits]** `gh api user/orgs` can be slow or rate-limited. → Mitigation: cache `listAccounts()` results for 5 minutes; show a "Refresh" button on the picker.

- **[Long-running submit looks frozen]** Clone + push + openspec init + worktree can take 30+ seconds. → Mitigation: progress view with per-step indicators (decision 7); the dialog cannot be dismissed mid-submit except via an explicit "Cancel" button that triggers rollback.

- **[Initial commit conflicts with provider auto-generated content]** `gh repo create` can optionally create a README/LICENSE on the remote, which would conflict with our local initial commit. → Mitigation: always pass `--description` only; never pass `--readme`, `--license`, or `--gitignore` to `gh repo create`. The resulting remote starts empty and our local commit pushes cleanly.

- **[Existing `cloneFromGitHub` refactor risk]** Extracting `cloneIntoRepos` from `projects.cloneFromGitHub` could regress the legacy `~/.21st/repos/...` fallback. → Mitigation: keep `cloneFromGitHub` as a thin wrapper around the new helper and cover the legacy path in a test.

- **[Symlink fallback drift on Windows]** Users editing AGENTS.md on Windows won't get CLAUDE.md updates. → Mitigation: top-of-file note in the templated AGENTS.md; future improvement could add a pre-commit hook, but that's out of scope here.

- **[Naming collision between the dialog and existing `ProjectSelector`]** The popover currently exposes Add Repository/Add from GitHub buttons; if we change those without removing them, users will see two affordances. → Mitigation: the change explicitly removes both old buttons and replaces them with a single "+ Add project" entry.

## Migration Plan

This is a UI-and-orchestration change; the database schema does not change. Rollout is straightforward:
1. Land the new `providers/`, `new-project/` (renderer + main), and `cloneIntoRepos` refactor under feature parity (open + clone behave exactly as before, new "Create" path is the only new surface).
2. Verify the empty-state shell, popover entry, and settings-tab entry all open the same dialog.
3. Manual smoke test for each provider (GitHub, Azure DevOps, Local) on macOS at minimum; Windows and Linux smoke tests should follow before broad release.
4. No data migration. Existing projects continue to load unchanged.

Rollback: the change is a UI replacement; rolling back means reverting the renderer and main-process file additions and the popover/settings-tab edits. No DB rollback needed.

## Open Questions

- **Should the wizard support GitHub Enterprise hostnames?** `gh` supports `gh repo create --hostname github.example.com`. Worth adding to the GitHub adapter's `listAccounts` input, or deferred to a follow-up? *Tentative answer: deferred — `gh` already honors `GH_HOST`, so power users can work around it; first-class support adds another UI field and another error mode.*
- **Should the initial commit author/email be the user's git config, or a Churro Coder identity?** Current behavior of `git commit` will use the user's local `user.name`/`user.email`. *Tentative answer: keep user's git config; do not override.*
