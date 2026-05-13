## ADDED Requirements

### Requirement: Provider adapters share a single contract
The main process SHALL expose a `ProviderAdapter` interface with the following capabilities: `id` (`'github' | 'azure' | 'local'`), `detectCli()` (does the CLI binary exist and what version), `checkAuth()` (is the CLI authenticated for write operations), `listAccounts()` (GitHub: user + orgs; Azure: configured organizations; Local: returns a synthetic single entry), `listProjects(accountId)` (Azure DevOps projects under an organization; GitHub and Local return `null`), `createRepo({ name, description, accountId, projectId?, visibility })`, and `getCloneUrl(...)` (HTTPS URL used by `git clone`). All adapter methods SHALL return discriminated-union results of the form `{ ok: true, ... } | { ok: false, code: ErrorCode, message: string }` rather than throwing for expected failures (missing CLI, unauthenticated, validation errors). All adapter methods SHALL accept a `correlationId` for tracing.

#### Scenario: Adapter selection by id
- **WHEN** the wizard requests an adapter for `'azure'`
- **THEN** the main process SHALL return the `AzureDevOpsAdapter` instance
- **WHEN** an unknown id is requested
- **THEN** the main process SHALL throw a programmer-error `Error` (this is an internal contract violation, not an expected runtime case)

#### Scenario: Adapter errors are discriminated unions, not exceptions
- **WHEN** `checkAuth()` finds the user is not logged in
- **THEN** the adapter SHALL return `{ ok: false, code: 'not-authenticated', message: '...' }`
- **THEN** the adapter SHALL NOT throw

### Requirement: CLI detection probes the binary and reports version
`detectCli()` SHALL spawn the CLI with `--version` using the same environment the rest of the app uses for shelling out (`getShellEnvironment()` for PATH on macOS/Linux, platform abstraction on Windows) and SHALL report `{ available: true, version: string }` on success or `{ available: false }` on `ENOENT`/non-zero exit. The probe SHALL time out after 5 seconds. Results SHALL be cached for 60 seconds keyed by adapter id.

#### Scenario: gh is installed
- **WHEN** the user has `gh` 2.x on PATH
- **THEN** the GitHub adapter's `detectCli()` SHALL return `{ available: true, version: '2.x.x' }`
- **THEN** a second call within 60 s SHALL return the cached result without re-spawning

#### Scenario: gh is missing
- **WHEN** `gh` is not on PATH
- **THEN** `detectCli()` SHALL return `{ available: false }`
- **THEN** the cache SHALL be populated with this negative result for 60 s

#### Scenario: Probe times out
- **WHEN** the CLI process hangs longer than 5 s
- **THEN** the probe SHALL kill the process and return `{ available: false }`
- **THEN** the negative cache entry SHALL be set so the UI does not stall again

### Requirement: Per-OS install instructions are surfaced when the CLI is missing
When `detectCli()` returns `{ available: false }`, the wizard SHALL render a `CliInstallInstructions` block tailored to the current OS using `getCurrentPlatformProvider()`. The block SHALL include: a one-line description of the CLI, the recommended install command for the user's OS, a copy-to-clipboard button next to the command, and a link to the official install docs. After installation the user SHALL have a "Recheck" button that bypasses the 60-second cache.

#### Scenario: macOS shows brew install gh
- **WHEN** the GitHub adapter reports unavailable on darwin
- **THEN** the install block SHALL show `brew install gh` as the primary command
- **THEN** a secondary link SHALL point to `https://cli.github.com/`

#### Scenario: Windows shows winget install GitHub.cli
- **WHEN** the GitHub adapter reports unavailable on win32
- **THEN** the install block SHALL show `winget install --id GitHub.cli` as the primary command
- **THEN** a fallback line SHALL mention `choco install gh`

#### Scenario: Linux shows distro-aware guidance
- **WHEN** the GitHub adapter reports unavailable on linux
- **THEN** the install block SHALL show the official apt/dnf snippet plus a link to `https://github.com/cli/cli/blob/trunk/docs/install_linux.md`

#### Scenario: Azure DevOps requires the azure-devops extension
- **WHEN** the Azure DevOps adapter reports the `az` binary is available but `az extension list` does not include `azure-devops`
- **THEN** `detectCli()` SHALL return `{ available: false, missingExtension: 'azure-devops' }`
- **THEN** the install block SHALL show `az extension add --name azure-devops` (not the base `az` install command)

#### Scenario: Recheck bypasses cache
- **WHEN** the user clicks "Recheck" in the install block
- **THEN** the cached `detectCli` result SHALL be evicted and a fresh probe SHALL run

### Requirement: Authentication is verified before any write call
Before invoking `createRepo` or pushing, the wizard SHALL call the adapter's `checkAuth()`. If `checkAuth()` returns `{ ok: false, code: 'not-authenticated' }`, the wizard SHALL block submission and render an inline auth panel with the exact command to run (`gh auth login` for GitHub, `az login` for Azure DevOps) and a "Retry" button.

#### Scenario: GitHub not signed in
- **WHEN** `gh auth status` exits non-zero
- **THEN** the adapter SHALL return `{ ok: false, code: 'not-authenticated' }`
- **THEN** the wizard SHALL show the inline "Sign in with gh auth login" panel
- **THEN** the Create button SHALL be disabled until the next successful `checkAuth`

#### Scenario: Azure DevOps not signed in
- **WHEN** `az account show` exits non-zero OR the user has no active subscription
- **THEN** the adapter SHALL return `{ ok: false, code: 'not-authenticated' }`
- **THEN** the wizard SHALL show the inline "Sign in with az login" panel

#### Scenario: Retry after sign-in
- **WHEN** the user runs the sign-in command in their terminal and clicks "Retry"
- **THEN** the wizard SHALL re-invoke `checkAuth()` (cache bypassed) and proceed if it now succeeds

### Requirement: Account/organization picker is populated from the CLI
For GitHub, `listAccounts()` SHALL return the authenticated user followed by their organizations, derived from `gh api user` and `gh api user/orgs`. For Azure DevOps, `listAccounts()` SHALL return the organizations known to `az` itself — derived from `az devops configure --list` (and, when that returns no default, an empty list). The desktop app SHALL NOT persist organization URLs in any form (no JSON file under userData, no Drizzle table, no main-process Map); manually-typed Azure DevOps organization URLs SHALL be valid only for the current submission, passed via `--organization https://dev.azure.com/<org>` to subsequent `az` calls. Renderer-side caching SHALL be the only caching layer for `listAccounts()` results and SHALL use tRPC's TanStack Query integration with a 5-minute `staleTime`; a "Refresh" affordance on the picker SHALL invalidate the query.

#### Scenario: GitHub accounts list
- **WHEN** the wizard opens with provider = GitHub and the user is authenticated as `alice` with orgs `acme` and `widgets`
- **THEN** the account picker SHALL show `alice` (badge: "Personal"), `acme`, `widgets`

#### Scenario: Azure DevOps organization typed manually
- **WHEN** the user pastes `https://dev.azure.com/contoso` into the Azure organization combobox
- **THEN** the adapter SHALL validate the URL format (host = `dev.azure.com`, single path segment)
- **THEN** `listProjects({ provider: 'azure', accountId: 'contoso' })` SHALL be called with `--organization https://dev.azure.com/contoso` and the response SHALL populate the next field
- **THEN** the desktop app SHALL NOT write the org URL to disk or to any main-process store

#### Scenario: Org not present after renderer reload
- **WHEN** the user typed `https://dev.azure.com/contoso` in a previous session and the renderer has since reloaded (or 5 minutes have elapsed since the last query)
- **THEN** the combobox SHALL only show orgs returned by the next `az devops configure --list` call
- **THEN** if the user wants to use the same org again they re-type it OR configure it via `az devops configure --defaults organization=https://dev.azure.com/contoso` in their terminal so the next CLI probe picks it up

#### Scenario: Refresh invalidates the cache
- **WHEN** the user clicks the "Refresh" button on the account picker
- **THEN** the cached `listAccounts` result SHALL be invalidated and a fresh CLI probe SHALL run
- **THEN** the updated list SHALL render in the combobox

#### Scenario: Azure DevOps project list
- **WHEN** the user selects organization `contoso`
- **THEN** the project picker SHALL show projects returned by `az devops project list --organization https://dev.azure.com/contoso`
- **THEN** the project list SHALL also be cached via React Query with a 5-minute `staleTime` keyed on `(provider, accountId)`

### Requirement: createRepo wraps CLI invocations safely
`createRepo({ name, description, accountId, projectId?, visibility })` SHALL invoke the CLI with argument arrays (never shell-concatenated strings) using `execFile`/`spawn` to avoid injection. The GitHub adapter SHALL call `gh repo create <accountId>/<name> --private --description <description> --confirm` (visibility defaults to private; `--public` when requested). The Azure DevOps adapter SHALL call `az repos create --name <name> --organization https://dev.azure.com/<accountId> --project <projectId> --output json`. The Local adapter SHALL `git init --initial-branch=main` in the target path and return `{ ok: true }`. All adapters SHALL return `{ ok: true, cloneUrl: string, htmlUrl?: string }` on success.

#### Scenario: GitHub repo creation, private by default
- **WHEN** the user submits with provider = GitHub, account = `alice`, name = `my-app`, visibility unset
- **THEN** the adapter SHALL invoke `gh` with arguments `['repo', 'create', 'alice/my-app', '--private', '--description', '<description>', '--confirm']`
- **THEN** the returned `cloneUrl` SHALL be `https://github.com/alice/my-app.git`

#### Scenario: Azure DevOps repo creation
- **WHEN** the user submits with org = `contoso`, project = `Platform`, name = `api`
- **THEN** the adapter SHALL invoke `az` with `['repos', 'create', '--name', 'api', '--organization', 'https://dev.azure.com/contoso', '--project', 'Platform', '--output', 'json']`
- **THEN** the returned `cloneUrl` SHALL be `https://dev.azure.com/contoso/Platform/_git/api`

#### Scenario: Local create is a git init
- **WHEN** the user submits with provider = Local and name = `my-app`
- **THEN** the adapter SHALL ensure `~/.churrostack/repos/local/my-app` exists and SHALL run `git init --initial-branch=main` inside it
- **THEN** the returned `cloneUrl` SHALL be `null` (or omitted)
- **THEN** no `git remote add` SHALL be performed

#### Scenario: Provider name collision is surfaced
- **WHEN** the remote rejects the create because a repo by that name already exists
- **THEN** the adapter SHALL return `{ ok: false, code: 'name-conflict', message: '<provider message>' }`
- **THEN** the wizard SHALL highlight the Project name field with the message

#### Scenario: CLI arguments are passed as arrays
- **WHEN** the description contains shell metacharacters (e.g., `$(rm -rf /)`)
- **THEN** the adapter SHALL still pass it as a single argv element via `execFile`, never as part of a `cmd /c` or shell string

### Requirement: tRPC surface exposes provider operations to the renderer
A new `newProject` tRPC router SHALL expose: `detectCli({ provider })`, `checkAuth({ provider })`, `listAccounts({ provider })`, `listProjects({ provider, accountId })`, `validateName({ provider, accountId, projectId?, name })`, and `createProject({ provider, accountId, projectId?, name, description, visibility, openspecInit, prompt })`. All inputs SHALL be validated with `zod`. The `createProject` procedure SHALL orchestrate the adapter calls, scaffolding, commit/push, openspec init, worktree creation, project row insert, and chat creation; it SHALL return `{ projectId, chatId, subChatId }` on success.

#### Scenario: detectCli is wired through tRPC
- **WHEN** the renderer calls `trpc.newProject.detectCli.useQuery({ provider: 'github' })`
- **THEN** the procedure SHALL invoke the GitHub adapter's `detectCli()` and return its result

#### Scenario: createProject returns IDs for chat handoff
- **WHEN** the renderer calls `trpc.newProject.createProject.mutate({...})` and creation succeeds
- **THEN** the mutation SHALL resolve with `{ projectId, chatId, subChatId }`
- **THEN** the renderer SHALL navigate to the returned chat and seed the pending message

#### Scenario: createProject input is validated
- **WHEN** the renderer calls `createProject` without a `name` or with `name: ''`
- **THEN** zod SHALL reject the input before any provider call is made
- **THEN** the error SHALL include the field path

### Requirement: Provider invocations log structured traces and do not log secrets
Every adapter method SHALL log a single line on entry and exit using the prefix `[Provider:<id>]` and including the `correlationId`, the operation name, the outcome (`ok=true|false`), and a compact reason on failure. Logs SHALL NOT include: auth tokens, full CLI stderr beyond the first line, the description, the initial prompt, or any environment variable values.

#### Scenario: Successful gh repo create emits a structured log
- **WHEN** the GitHub adapter creates `alice/my-app`
- **THEN** the log SHALL contain `[Provider:github] <correlationId> op=createRepo target=alice/my-app ok=true`

#### Scenario: Failure log is compact
- **WHEN** `gh repo create` exits with a 5-line stderr
- **THEN** the log line SHALL include only the first line of stderr as `reason="<first line>"`
- **THEN** the full stderr SHALL NOT be written to the log

#### Scenario: Tokens are never logged
- **WHEN** any adapter spawns a CLI subprocess
- **THEN** the log SHALL NOT include `GITHUB_TOKEN`, `AZURE_DEVOPS_EXT_PAT`, or any value of those env vars
