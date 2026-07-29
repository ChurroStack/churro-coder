## ADDED Requirements

### Requirement: Native CLI harnesses are bootstrapped per subChat

For each `harness IN ('claude-cli','codex-cli')`, the desktop main process SHALL provide a bootstrap routine that takes a `subChatId` and produces a `TerminalBootstrap` record (cwd, env, command, args, optional `initialInput`, optional `idleDetection`) suitable for `terminal:createOrAttach`. The bootstrap MUST:

1. Resolve the binary on `PATH` using a deterministic lookup (`claude` or `codex`); fail with an actionable error if missing.
2. Inject `CHURRO_SUBCHAT_ID=<subChatId>` into the spawned environment.
3. Inject MCP server connection info (URL + bearer) using the binary's preferred mechanism — for `claude`, by writing/merging the per-user CLI config; for `codex`, via `--mcp-config <path>` or its supported env var. The injected MCP URL MUST point at the per-subchat path-scoped endpoint (see `chat-surface-router` and the MCP requirement below).
4. Set `cwd` to the chat's workspace cwd (same value the standalone terminal panel uses).
5. Optionally include `initialInput` to be written to the PTY immediately after spawn (for first-launch `/init`-style commands).

#### Scenario: Bootstrap for Claude CLI
- **WHEN** the harness bootstrap is invoked with `harness='claude-cli'` and a `subChatId`
- **THEN** the returned record has `command='claude'` and `env.CHURRO_SUBCHAT_ID=<subChatId>`
- **AND** the Claude CLI config has been merged with an MCP server entry pointing at `http://127.0.0.1:<port>/sub/<subChatId>/`

#### Scenario: Bootstrap for Codex CLI
- **WHEN** the harness bootstrap is invoked with `harness='codex-cli'` and a `subChatId`
- **THEN** the returned record has `command='codex'`, args contain `--mcp-config <path>`, and `env.CHURRO_SUBCHAT_ID=<subChatId>`
- **AND** the referenced MCP config file points at `http://127.0.0.1:<port>/sub/<subChatId>/` with the current bearer token

#### Scenario: Binary missing from PATH
- **WHEN** the harness bootstrap cannot resolve the requested CLI binary
- **THEN** it returns a typed error with a user-readable message naming the missing binary and a hint to install it
- **AND** the chat panel renders the error in place of the terminal with a Retry action

### Requirement: Per-subChat MCP routing isolates artifact writes

The MCP HTTP transport SHALL accept requests at `/sub/<subChatId>/...` in addition to the existing root path. Requests on the path-scoped route MUST be handled by `createMcpServerForSubChat(<subChatId>)`. The bearer token MUST still be required and identical across routes. The root route remains available for the in-process built-in path during this change.

#### Scenario: CLI tool call writes plan to its own subChat
- **WHEN** a `claude` CLI bootstrapped for `subChatId='A'` calls the MCP tool `write_review` (or future `write_plan`)
- **THEN** the file is written under `<userData>/sub-chats/A/`
- **AND** no artifacts under any other `subChatId` directory are touched

#### Scenario: Wrong subChatId in URL is rejected
- **WHEN** a request arrives at `/sub/<unknown-id>/` with a valid bearer
- **THEN** the response is a structured error and no filesystem write happens

#### Scenario: Bearer mismatch is rejected on path-scoped route
- **WHEN** a request arrives at `/sub/<id>/` with an invalid or missing bearer
- **THEN** the response is HTTP 401 and no MCP server instance is created

### Requirement: Plan / review sidebars react to CLI-driven artifact writes

When a CLI MCP tool writes a plan or review file for a subChat, the existing per-subchat artifact-watch + tRPC subscription plumbing MUST invalidate the `getCurrentPlan` / `getCurrentReview` / `getReviewContent` queries for that subChat so the corresponding sidebars refresh without requiring user action.

#### Scenario: Plan file written via MCP triggers sidebar refresh
- **WHEN** a CLI calls the MCP write tool that updates the plan file for subChat `A`
- **THEN** any open plan sidebar bound to subChat `A` re-fetches `getCurrentPlan` within the existing watch debounce window
- **AND** the new plan content is rendered

### Requirement: Completed native reviews refresh the current Review artifact

When a native review completes, the CLI harness SHALL make it the current
per-subChat Review artifact and the Review widget SHALL refresh through the
existing artifact notification path. Codex structured review findings and
Claude `ReportFindings` output SHALL be rendered as the canonical Code Review
markdown: a concise summary followed by a severity table with `🔴 high`,
`🟡 medium`, or `🟢 low` rows. Already-canonical review markdown SHALL be
preserved. When only unstructured native output is available, the harness SHALL
persist a headed markdown review without inventing severity or dropping the raw
details.

The completed native review event identity and completion time SHALL be carried
to persistence. A newer completed native review replaces an older artifact, but
replay and race handling SHALL not replace a newer explicit MCP `write_review`
artifact. Persistence SHALL trace whether the native result was written,
skipped, or required the unstructured fallback without logging review content.

#### Scenario: Codex native review refreshes the Review widget
- **WHEN** Codex emits `exited_review_mode` with structured findings for subChat `A`
- **THEN** the findings are written as `A`'s current Review artifact using the
  canonical severity table
- **AND** the Review widget for `A` refreshes without a manual reload

#### Scenario: Native review result is newer than the prior native artifact
- **WHEN** a completed native review for subChat `A` has a completion time later
  than the stored native review
- **THEN** it replaces the stored Review artifact

#### Scenario: Replay does not overwrite a newer explicit review
- **WHEN** an ingester replays an older native review event after an explicit
  MCP `write_review` result has been persisted
- **THEN** the explicit Review artifact remains current

### Requirement: Per-CLI input adapter translates UI controls to slash commands

Each CLI harness SHALL ship a small input adapter that maps recognized UI control changes (mode, model, etc.) to the CLI's slash-command syntax. Adapters MUST be detected and version-checked at bootstrap time. Unsupported translations MUST be silently skipped with a trace log; they MUST NOT block the user's prompt body from being sent.

#### Scenario: Claude CLI model translation
- **WHEN** the user changes model to "opus" and sends "x" through a `claude-cli` chat
- **THEN** the adapter emits `/model opus\n` followed by `x\n`

#### Scenario: Codex CLI mode translation
- **WHEN** the user toggles to a mode the Codex adapter understands and sends "x"
- **THEN** the adapter emits the corresponding Codex slash command followed by `x\n`

#### Scenario: Adapter cannot translate; prompt still sends
- **WHEN** the adapter has no mapping for the requested toggle
- **THEN** only `x\n` is sent
- **AND** a trace log entry records `slash-translation skipped` with the harness id and the toggle name

### Requirement: CLI-backed chats trace boundary events

The harness bootstrap, PTY spawn, MCP per-request handling, and slash-command translation skips MUST emit trace logs that include `subChatId` and `harness`. Trace logs MUST NOT include the bearer token, the prompt body, raw PTY output, or the contents of plan/review files.

#### Scenario: Bootstrap success traces cleanly
- **WHEN** a CLI harness bootstrap runs and succeeds
- **THEN** a single trace log line records `harness-bootstrap ok` with `subChatId`, `harness`, resolved binary path, and PTY pid
- **AND** the line contains no bearer or prompt content
