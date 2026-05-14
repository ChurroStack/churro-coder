## ADDED Requirements

### Requirement: New Project dialog is the single entry point for adding projects
The desktop app SHALL expose a unified `NewProjectDialog` as the single entry point for all "add project" actions. The dialog SHALL offer three sibling sections — **Create new project**, **Open existing folder**, **Clone existing repository** — and SHALL be reachable from (a) the empty-state screen shown when no project is selected, (b) the "+ Add project" affordance in the `ProjectSelector` popover, and (c) the "+" button in the settings → Projects tab.

#### Scenario: Empty state opens the dialog inline
- **WHEN** the app launches with no project selected
- **THEN** the renderer SHALL render an empty-state shell that mounts `NewProjectDialog` inline (no separate `SelectRepoPage`)
- **THEN** the dialog SHALL default to the **Create new project** section with GitHub as the selected provider

#### Scenario: + Add project from the project selector
- **WHEN** the user clicks "+ Add project" in the `ProjectSelector` popover footer
- **THEN** the popover SHALL close and `NewProjectDialog` SHALL open as a modal
- **THEN** the dialog SHALL default to the **Create new project** section

#### Scenario: + Add project from settings
- **WHEN** the user clicks the "+" button in the Settings → Projects tab
- **THEN** `NewProjectDialog` SHALL open with the same three sibling sections

#### Scenario: Existing two-button select-repo UI is removed
- **WHEN** the renderer renders the empty state
- **THEN** the legacy two-button `SelectRepoPage` SHALL NOT be rendered
- **THEN** the popover footer SHALL NOT show separate "Add repository" and "Add from GitHub" buttons

### Requirement: Create-new section is styled like the New Workspace UI
The **Create new project** section SHALL use the same layout primitives as the New Workspace form: numbered `WizardSection` blocks for each step, a segmented control for the provider choice, option cards for binary/ternary choices, and the shared `max-w-5xl` content width. The right side of the dialog SHALL render a contextual help panel that updates as the user focuses each field, showing 1–3 concrete examples per field.

#### Scenario: Provider is rendered as a segmented control
- **WHEN** the user is on the Create new project section
- **THEN** the provider chooser SHALL render as a segmented control with three segments: **GitHub** (default-selected), **Azure DevOps**, **Local**
- **THEN** changing the segment SHALL update the visible fields without losing values already entered for fields common to all providers (name, description, prompt, OpenSpec toggle)

#### Scenario: Help panel updates with focus
- **WHEN** the user focuses the Project name input
- **THEN** the help panel SHALL show the name rules and examples (e.g., "my-awesome-app", "data-pipeline")
- **WHEN** the user focuses the Initial prompt textarea
- **THEN** the help panel SHALL show prompt examples (e.g., "An Nx monorepo with a Vite + React frontend and an ASP.NET API")

### Requirement: Project name is validated as a provider-safe slug
The Project name field SHALL be validated synchronously in the renderer and SHALL be the source of both the remote repository name and the on-disk folder name. The name MUST match `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`, MUST NOT end with `.git` or `.`, MUST NOT contain consecutive dots, and MUST NOT equal a reserved name (`.`, `..`, `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`). The dialog SHALL also call the `newProject.validateName` tRPC procedure with the selected provider before allowing submit; that call SHALL additionally check that the on-disk target (`~/.churrostack/repos/<owner>/<name>` for GitHub/Azure, `~/.churrostack/repos/local/<name>` for Local) does not already exist.

#### Scenario: Invalid characters are rejected
- **WHEN** the user types `my project!` into the Project name field
- **THEN** the field SHALL show an inline error ("Names can only contain letters, numbers, dots, hyphens, and underscores")
- **THEN** the Submit button SHALL be disabled

#### Scenario: Reserved name is rejected
- **WHEN** the user types `CON` (case-insensitive) into the Project name field
- **THEN** the field SHALL show an inline error ("This name is reserved by the operating system")

#### Scenario: Target path already exists
- **WHEN** the user enters `existing-repo` and a folder already exists at `~/.churrostack/repos/<owner>/existing-repo`
- **THEN** the `validateName` server check SHALL return `{ ok: false, reason: "target-exists" }`
- **THEN** the dialog SHALL show "A folder named existing-repo already exists at the clone location"

#### Scenario: Valid name passes both checks
- **WHEN** the user enters `my-awesome-app`
- **THEN** the renderer regex SHALL accept it
- **THEN** the server check SHALL return `{ ok: true }`
- **THEN** Submit SHALL be enabled (assuming the rest of the form is valid)

### Requirement: Description is optional free text used as repo description
The Description field SHALL be a single-line text input, optional, with a 350-character soft cap. The value SHALL be passed to the provider adapter as the repository description when creating a new GitHub or Azure DevOps repo, and SHALL also be embedded in the templated `README.md` of the initial commit.

#### Scenario: Description forwarded to GitHub
- **WHEN** the user creates a GitHub project with description "A toy URL shortener"
- **THEN** `gh repo create` SHALL be invoked with `--description "A toy URL shortener"`
- **THEN** the generated `README.md` SHALL include the description text below the project name heading

#### Scenario: Empty description is allowed
- **WHEN** the user leaves the Description blank
- **THEN** the form SHALL still be submittable
- **THEN** the provider adapter SHALL omit the description argument
- **THEN** the generated `README.md` SHALL contain only the project name heading

### Requirement: Every React Query-cached datum has a user-invokable refresh control
For every renderer-side cached datum in the New Project flow (CLI detection, auth status, account/org list, project list, and any future cached query added to this flow), the wizard SHALL render a visible control that, on click, invalidates the underlying React Query entry and triggers an immediate re-fetch. The control SHALL be placed in the same `WizardSection` (or panel) as the cached data, SHALL use a clear action verb consistent with the surface (**Refresh** for list pickers, **Recheck** for CLI/install panels, **Retry** for auth panels), and SHALL show an in-flight spinner state while the re-fetch is running. The only exempt query is `validateName`, which is debounced per keystroke and is naturally re-triggered by the next edit.

#### Scenario: Account picker exposes Refresh
- **WHEN** the account/org picker is rendered for any provider
- **THEN** a "Refresh" button SHALL be visible next to the combobox
- **WHEN** the user clicks "Refresh"
- **THEN** `utils.newProject.listAccounts.invalidate({ provider })` SHALL be called
- **THEN** a fresh CLI probe SHALL run and the updated list SHALL replace the cached one

#### Scenario: Project picker exposes Refresh
- **WHEN** the Azure DevOps project picker is rendered with a selected organization
- **THEN** a "Refresh" button SHALL be visible next to the combobox
- **WHEN** the user clicks "Refresh"
- **THEN** `utils.newProject.listProjects.invalidate({ provider: 'azure', accountId })` SHALL be called for the currently selected `accountId`

#### Scenario: CLI install panel exposes Recheck
- **WHEN** the CLI install-instructions panel is rendered (because `detectCli` returned unavailable)
- **THEN** a "Recheck" button SHALL be visible
- **WHEN** the user clicks "Recheck"
- **THEN** the main-process `detectCli` cache entry for that provider SHALL be evicted AND `utils.newProject.detectCli.invalidate({ provider })` SHALL be called

#### Scenario: Auth panel exposes Retry
- **WHEN** the auth-required panel is rendered (because `checkAuth` returned `not-authenticated`)
- **THEN** a "Retry" button SHALL be visible
- **WHEN** the user clicks "Retry"
- **THEN** `utils.newProject.checkAuth.invalidate({ provider })` SHALL be called

#### Scenario: Spinner state during re-fetch
- **WHEN** the user clicks any of Refresh / Recheck / Retry
- **THEN** the control SHALL render an in-flight spinner state until the new query resolves
- **THEN** the rest of the wizard SHALL remain interactive (the refresh is scoped to its own panel)

#### Scenario: validateName is exempt from a refresh control
- **WHEN** the user is typing in the Project name field
- **THEN** no Refresh button SHALL be rendered next to that field
- **THEN** edits to the field SHALL naturally re-trigger the debounced `validateName` query

### Requirement: GitHub Public checkbox controls repository visibility
For the GitHub provider, the wizard SHALL render a single "Public" checkbox under the Description field, unchecked by default. When checked, the renderer SHALL pass `visibility: 'public'` to `createProject`; when unchecked, the renderer SHALL omit the field (server defaults to `'private'`). The checkbox SHALL NOT be rendered for the Azure DevOps or Local providers — Azure DevOps repository visibility inherits from the parent project and is not controlled by `az repos create`, and Local projects have no remote.

#### Scenario: Default GitHub project is private
- **WHEN** the user submits a GitHub project without checking "Public"
- **THEN** `createProject` SHALL be called without a `visibility` field (or with `visibility: 'private'`)
- **THEN** the GitHub adapter SHALL invoke `gh repo create` with `--private`

#### Scenario: Public checkbox creates a public GitHub repo
- **WHEN** the user checks "Public" and submits a GitHub project
- **THEN** `createProject` SHALL be called with `visibility: 'public'`
- **THEN** the GitHub adapter SHALL invoke `gh repo create` with `--public`

#### Scenario: Public checkbox is hidden for Azure DevOps
- **WHEN** the provider segmented control is set to Azure DevOps
- **THEN** the "Public" checkbox SHALL NOT be rendered

#### Scenario: Public checkbox is hidden for Local
- **WHEN** the provider segmented control is set to Local
- **THEN** the "Public" checkbox SHALL NOT be rendered

#### Scenario: Provider-level permission error is surfaced after submit
- **WHEN** the user checks "Public" against a GitHub org that does not allow public repos
- **THEN** the wizard SHALL submit anyway (no pre-flight permission probe)
- **THEN** `gh repo create` SHALL fail and the wizard SHALL surface the provider's error message inline on the visibility field

### Requirement: OpenSpec init toggle controls post-clone initialization
The wizard SHALL show an **Initialize OpenSpec** toggle. The toggle SHALL be enabled by default if the `openspec` binary is available (per `assertOpenspecBinAvailable`) and SHALL be disabled (with an inline hint) otherwise. When enabled, after the worktree is created the system SHALL run `openspec init` in the project root with the same execution surface used by `chats.openspecInit`.

#### Scenario: Toggle on runs openspec init
- **WHEN** the user submits the wizard with **Initialize OpenSpec** checked
- **THEN** after the initial commit and worktree creation, the system SHALL invoke `openspec init` in the new project root
- **THEN** any failure of `openspec init` SHALL be surfaced as a non-fatal warning toast — the project creation SHALL still be reported as successful

#### Scenario: Toggle off skips openspec init
- **WHEN** the user submits the wizard with **Initialize OpenSpec** unchecked
- **THEN** the system SHALL NOT invoke `openspec init`
- **THEN** no `openspec/` directory SHALL be created in the new project

#### Scenario: Openspec binary missing disables toggle
- **WHEN** the renderer queries `newProject.detectCli` for `openspec` and the response is `{ available: false }`
- **THEN** the toggle SHALL be rendered disabled and unchecked
- **THEN** an inline hint SHALL explain that OpenSpec is not available and SHALL link to install instructions

### Requirement: Initial prompt is required and seeds an execute-mode chat
The wizard SHALL show an **Initial prompt** textarea (required, minimum 10 non-whitespace characters, maximum 4000). On successful project creation, the system SHALL create a `chats` row and an initial `subChats` row with `mode = 'execute'`, store the user's prompt in the `pendingExecuteMessageAtom` for that sub-chat, and navigate the UI to that chat so the prompt is queued to send.

#### Scenario: Submit requires a prompt
- **WHEN** the user submits the form without entering a prompt
- **THEN** the form SHALL show an inline error on the prompt field ("Describe what you want to build (at least 10 characters)")
- **THEN** no provider calls SHALL be made

#### Scenario: Successful submit hands off to execute mode chat
- **WHEN** project creation completes successfully
- **THEN** the system SHALL create a new chat for the project, with a default name derived from the project name
- **THEN** the initial sub-chat SHALL have `mode = 'execute'`
- **THEN** the renderer SHALL set the selected project and selected chat, close the dialog, and surface the prompt as the pending message in the new chat input
- **THEN** the chat input SHALL be focused so the user can review and press Enter to send

### Requirement: Successful creation scaffolds standard agent files in an initial commit
On a successful **Create new project** submission, the system SHALL produce an initial commit on `main` containing the following templated files at the repository root:
- `AGENTS.md` — rendered from `apps/desktop/resources/new-project-templates/AGENTS.md.tmpl` with `{{name}}`, `{{description}}`, and `{{prompt}}` substituted.
- `CLAUDE.md` — a symlink to `AGENTS.md` on macOS/Linux; on Windows, a copy of `AGENTS.md` (fallback because git symlinks require Developer Mode).
- `.gitignore` — rendered from `.gitignore.tmpl`.
- `README.md` — rendered from `README.md.tmpl` with `{{name}}` and `{{description}}` substituted.

For GitHub and Azure DevOps providers, this commit SHALL be pushed to the remote on `main`. For Local, the commit SHALL exist locally only.

#### Scenario: AGENTS.md is generated with the user's prompt embedded
- **WHEN** the user creates a project with prompt "Nx monorepo with React + ASP.NET"
- **THEN** the generated `AGENTS.md` SHALL contain a section that quotes that prompt as the initial intent
- **THEN** `CLAUDE.md` SHALL resolve to the same file content

#### Scenario: Windows fallback uses a copy instead of a symlink
- **WHEN** the runtime platform is `win32`
- **THEN** `CLAUDE.md` SHALL be written as a regular file with the same content as `AGENTS.md`
- **THEN** the initial commit SHALL contain both files as blobs

#### Scenario: Initial commit is pushed for remote providers
- **WHEN** the provider is GitHub or Azure DevOps
- **THEN** after staging and committing the templated files, `git push -u origin main` SHALL run from the repo root
- **THEN** push failures SHALL abort the wizard with a rollback (see *Failure rollback*)

#### Scenario: Local provider does not push
- **WHEN** the provider is Local
- **THEN** no `git remote add` or `git push` SHALL run
- **THEN** the project record SHALL have `gitRemoteUrl = null` and `gitProvider = null`

### Requirement: New projects are placed under the existing managed repos root
For GitHub the new clone SHALL live at `~/.churrostack/repos/<owner>/<name>`. For Azure DevOps the new clone SHALL live at `~/.churrostack/repos/<organization>/<project>/<name>`. For Local the project SHALL live at `~/.churrostack/repos/local/<name>`. After the on-disk repo exists, the system SHALL insert a row into the `projects` table with the appropriate `gitProvider`, `gitOwner` (or organization), `gitRepo` (= name), `gitProject` (Azure project, otherwise `null`), and `path`.

#### Scenario: GitHub project row
- **WHEN** the user creates `my-app` under GitHub org `acme`
- **THEN** the clone SHALL be at `~/.churrostack/repos/acme/my-app`
- **THEN** the `projects` row SHALL have `gitProvider = 'github'`, `gitOwner = 'acme'`, `gitRepo = 'my-app'`, `gitProject = null`

#### Scenario: Azure DevOps project row
- **WHEN** the user creates `my-app` under organization `https://dev.azure.com/contoso` and project `Platform`
- **THEN** the clone SHALL be at `~/.churrostack/repos/contoso/Platform/my-app`
- **THEN** the `projects` row SHALL have `gitProvider = 'azure'`, `gitOwner = 'contoso'`, `gitRepo = 'my-app'`, `gitProject = 'Platform'`

#### Scenario: Local project row
- **WHEN** the user creates `my-app` as Local
- **THEN** the project SHALL be `git init`'d at `~/.churrostack/repos/local/my-app` with initial branch `main`
- **THEN** the `projects` row SHALL have `gitProvider = null`, `gitOwner = null`, `gitRepo = null`, `gitProject = null`, `path = ~/.churrostack/repos/local/my-app`

### Requirement: Worktree is created and handed off to a new execute-mode chat
After the project row is inserted, the system SHALL call the existing `createWorktreeForChat()` logic to create the first chat workspace pointing at the `main` branch. The chat row SHALL be created in the same transaction surface as today's chat creation, with `mode = 'execute'` on the initial sub-chat. The user SHALL be navigated to that chat with the initial prompt pre-filled as the pending message.

#### Scenario: First chat appears in execute mode
- **WHEN** a project is successfully created
- **THEN** the renderer SHALL set `selectedProjectAtom` to the new project and `selectedAgentChatIdAtom` to the new chat id
- **THEN** the initial sub-chat row SHALL have `mode = 'execute'`
- **THEN** the worktree path SHALL follow the existing `~/.churrostack/worktrees/<projectSlug>/<workspaceName>` layout

### Requirement: Failure rollback keeps state consistent
If any post-create step (clone, initial commit, push, openspec init, worktree create, db insert) fails, the system SHALL roll back observable state in reverse order: delete the local clone directory if it was just created, delete the remote repository for newly created GitHub/Azure repos *only if the failure occurred before the initial push completed*, and SHALL NOT leave a `projects` row referencing a path that no longer exists. The user SHALL see a single toast describing what failed and at what step.

#### Scenario: Clone failure after remote create
- **WHEN** `gh repo create` succeeds but the subsequent `git clone` fails
- **THEN** the system SHALL attempt to delete the just-created remote repo via `gh repo delete --yes <owner>/<name>`
- **THEN** no `projects` row SHALL be inserted
- **THEN** the toast SHALL read "Couldn't clone the new repository — created remote was removed"

#### Scenario: openspec init failure is non-fatal
- **WHEN** `openspec init` exits non-zero after the worktree exists and the project row is inserted
- **THEN** the project SHALL remain in the database and on disk
- **THEN** the user SHALL see a non-fatal warning toast and the chat handoff SHALL still occur

#### Scenario: Push failure after local commit
- **WHEN** the initial commit succeeds locally but `git push` fails (network, auth)
- **THEN** the system SHALL leave the local clone intact (user can retry push manually)
- **THEN** the `projects` row SHALL still be inserted so the user does not lose work
- **THEN** the toast SHALL include the underlying error and a hint to check the provider CLI

### Requirement: Open existing folder and Clone existing repo paths are preserved
The dialog's **Open existing folder** section SHALL preserve today's `projects.openFolder` behavior (native folder picker, git remote info extraction, project row insert). The **Clone existing repository** section SHALL preserve today's `projects.cloneFromGitHub` behavior (parse owner/repo, clone into `~/.churrostack/repos/<owner>/<repo>`, project row insert) and SHALL additionally accept Azure DevOps clone URLs (`https://dev.azure.com/<org>/<project>/_git/<repo>`) routed through the same shared `cloneIntoRepos` helper.

#### Scenario: Open existing folder still works
- **WHEN** the user picks the **Open existing folder** section and selects a folder
- **THEN** the system SHALL invoke the same logic as today's `projects.openFolder`
- **THEN** the resulting project SHALL be selected and the dialog SHALL close

#### Scenario: Clone existing GitHub repo still works
- **WHEN** the user picks **Clone existing repository** and enters `facebook/react`
- **THEN** the system SHALL clone to `~/.churrostack/repos/facebook/react` (legacy `~/.21st/repos/...` fallback preserved)
- **THEN** the resulting project SHALL be selected and the dialog SHALL close

#### Scenario: Clone existing Azure DevOps repo
- **WHEN** the user enters `https://dev.azure.com/contoso/Platform/_git/api`
- **THEN** the system SHALL parse `organization=contoso`, `project=Platform`, `repo=api`
- **THEN** the clone SHALL land at `~/.churrostack/repos/contoso/Platform/api`

### Requirement: Project creation emits structured trace logs and analytics
The main process SHALL emit `[NewProject]` log lines at each step boundary (validate, cli-detect, auth-check, remote-create, clone, scaffold, commit, push, openspec-init, worktree-create, db-insert, chat-create) including a stable `correlationId`, the `provider`, the outcome, and a compact error string on failure. On success, the system SHALL call `trackProjectCreated({ provider, openspecInit, hasPrompt })` in addition to the existing `trackProjectOpened` call. Logs SHALL NOT include the initial prompt, the description, secrets, or auth tokens.

#### Scenario: Successful run emits an ordered log trail
- **WHEN** a GitHub project is created end-to-end
- **THEN** the main process log SHALL contain `[NewProject] <correlationId> step=validate ok=true` followed by entries for each subsequent step, ending with `step=chat-create ok=true`

#### Scenario: Failure log includes step and compact error
- **WHEN** `git push` fails with "remote rejected"
- **THEN** the log line for `step=push` SHALL include `ok=false reason="remote rejected"` (no full stderr dump beyond a single compact line)

#### Scenario: Analytics fires on success only
- **WHEN** project creation completes successfully
- **THEN** `trackProjectCreated` SHALL be called exactly once with `{ provider, openspecInit, hasPrompt: true }`
- **WHEN** project creation fails
- **THEN** `trackProjectCreated` SHALL NOT be called
