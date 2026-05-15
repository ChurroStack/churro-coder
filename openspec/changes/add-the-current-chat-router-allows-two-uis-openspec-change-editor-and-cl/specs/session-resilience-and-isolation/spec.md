## ADDED Requirements

### Requirement: App restart restores every open subChat to a usable state for its harness

After an app restart, every previously-open chat panel SHALL re-mount with its `subChatId`, `harness`, and `openspecChangeId` preserved, and SHALL be usable without the user having to recreate the chat. "Usable" is defined per harness:

- `harness='builtin'` (with or without `openspecChangeId`): message history is loaded from SQLite; any in-flight stream that was running at shutdown is treated as terminated (its last partial message is dropped); sidebars (plan, review) reflect the latest persisted artifact files on disk.
- `harness IN ('claude-cli','codex-cli')`: the panel re-mounts in a **disconnected** state showing the persisted xterm scrollback and a non-modal banner "Session ended on restart — Reattach (new CLI session; ask it to read the current plan to continue)". When the panel becomes the active tab (or the user clicks Reattach), the CLI bootstrap re-runs and a **fresh** PTY is spawned with no resume flag and no inherited CLI conversation state. The CLI MUST NOT be spawned eagerly for non-active panels at boot. Continuity of work across the restart is delivered solely through the per-subChat plan/review/etc files on disk, which the new CLI session can read through MCP on its first turn.

For all harnesses, restoring a subChat MUST NOT trigger a write to that subChat's plan/review artifact files; restoration is read-only with respect to artifacts.

#### Scenario: Built-in chat restores message history with no in-flight stream
- **GIVEN** a `builtin` subChat with 12 persisted messages and a 13th in-flight at shutdown
- **WHEN** the app restarts and the panel re-mounts
- **THEN** the message list shows the 12 persisted messages
- **AND** the 13th partial message is not shown
- **AND** the chat status is `idle` (not `streaming`)

#### Scenario: CLI chat restores scrollback but stays disconnected until activated
- **GIVEN** a `claude-cli` subChat whose panel was open at shutdown
- **WHEN** the app restarts
- **THEN** the panel re-mounts with the previous xterm scrollback visible
- **AND** no `claude` process is spawned at boot
- **AND** a banner reads "Session ended on restart — Reattach" with a CTA button
- **WHEN** the user clicks Reattach (or activates the tab)
- **THEN** the CLI bootstrap runs and a new `claude` PTY is spawned with the current MCP bearer/port

#### Scenario: Restoration is read-only for artifacts
- **GIVEN** any subChat with an existing `plans/current.md`
- **WHEN** the panel re-mounts at app boot
- **THEN** `plans/current.md` and `plans/current.meta.json` mtimes are unchanged
- **AND** no `.tmp` files appear in that subChat's plans/ directory

### Requirement: CLI bootstrap rewrites per-subChat config files at every spawn

The CLI harness bootstrap layer SHALL write the per-CLI MCP config (Claude config edits and/or Codex `--mcp-config` file) to a fixed path `<userData>/cli-bootstrap/<subChatId>.<harness>.<ext>` at **every** PTY spawn, fully overwriting any previous content, using the current app session's MCP `{port, bearer}` from `<userData>/churro-mcp.json`. Pre-existing files MUST NOT be reused — they are always assumed to reference a dead previous-session MCP.

The bootstrap MUST also re-inject `CHURRO_SUBCHAT_ID=<subChatId>` into the CLI process environment on every spawn.

#### Scenario: Config file is rewritten across an app restart
- **GIVEN** a `codex-cli` subChat that was spawned during app session A (MCP port 47101, bearer "abc")
- **WHEN** the app restarts and session B begins (MCP port 47433, bearer "xyz")
- **AND** the user activates the panel to reattach
- **THEN** `<userData>/cli-bootstrap/<subChatId>.codex-mcp.json` contains the URL `http://127.0.0.1:47433/sub/<subChatId>/` and bearer "xyz"
- **AND** the file's mtime is after the app B boot timestamp

#### Scenario: Hard-reset within a single session also rewrites the config
- **GIVEN** an active `claude-cli` subChat
- **WHEN** the user triggers Hard-reset
- **THEN** the per-subChat config file is rewritten with the current bearer/port (even though they may be unchanged)

### Requirement: MCP HTTP transport is the only path external CLIs can reach tools, scoped per subChatId

External (CLI-harness) MCP traffic MUST go through the path-scoped URL `http://127.0.0.1:<port>/sub/<subChatId>/`. The root `/` route remains in-process / built-in only and MUST refuse requests whose bearer matches the external bootstrap bearer when there is no subChatId in the URL. Every request on any route MUST validate the bearer; mismatches return HTTP 401 with no body details. Requests under `/sub/<id>/` where `<id>` is not a known subChatId MUST return a structured JSON-RPC error and log a trace `[mcp] reject unknown subChat id=<id>`.

The MCP server constructed for a `/sub/<id>/` request MUST close over that subChatId; `read_plan`, `read_review`, and `write_review` invoked through that route MUST resolve their target paths from the closed-over id only — never from tool arguments — so a buggy CLI cannot redirect a write to another subchat's directory.

#### Scenario: Unknown subChatId is rejected
- **WHEN** a request hits `/sub/nonexistent/` with a valid bearer
- **THEN** the response is a JSON-RPC error result
- **AND** a trace `[mcp] reject unknown subChat id=nonexistent` is emitted

#### Scenario: Tool argument cannot override the path-scoped subChatId
- **GIVEN** a path-scoped MCP server for subChatId "A"
- **WHEN** a `write_review` call arrives at `/sub/A/` with arguments attempting to set `subChatId: "B"`
- **THEN** the write lands under `<userData>/sub-chats/A/reviews/` (never under `B/`)
- **AND** the tool's argument schema omits / ignores `subChatId` for the path-scoped factory

#### Scenario: Bearer mismatch returns 401 with no details
- **WHEN** a request to `/sub/<any-id>/` arrives with a wrong bearer
- **THEN** the response is HTTP 401
- **AND** the response body does not include the expected bearer, the offending id, or any internal state

### Requirement: Plan and review artifact writes are crash-safe via 3-phase atomic write

All writes to `<userData>/sub-chats/<subChatId>/plans/current.md`, `plans/current.meta.json`, `reviews/current.md`, and `reviews/current.meta.json` SHALL go through a single helper `atomicWriteArtifact(path, body)` whose contract is:

1. Write body to `<path>.tmp` with `fsync` before close.
2. `rename(<path>.tmp, <path>)`.
3. Only after the body file has been renamed, write the corresponding `.meta.json` using the same tmp-fsync-rename sequence.

On app boot (after the DB migration step), the main process SHALL sweep `<userData>/sub-chats/*/plans/` and `<userData>/sub-chats/*/reviews/` for any `*.tmp` files left from a prior crashed write and unlink them, logging `[artifact-sweep] removed orphan <path>` per file.

#### Scenario: Crash between body rename and meta rename is recoverable
- **GIVEN** a write that completed phase 2 (body renamed) but crashed before phase 3 (meta updated)
- **WHEN** the app reboots
- **THEN** `current.md` reflects the new body
- **AND** `current.meta.json` still reflects the prior revision
- **AND** readers continue to function (no parse error); the next successful write reconciles meta

#### Scenario: Orphan tmp files are swept at boot
- **GIVEN** `<userData>/sub-chats/<id>/plans/current.md.tmp` exists from a crashed prior session
- **WHEN** the app boots
- **THEN** the file is unlinked
- **AND** a trace `[artifact-sweep] removed orphan` is logged for it

#### Scenario: All artifact writes go through the helper
- **WHEN** the codebase is grepped for direct `fs.writeFile`/`fs.promises.writeFile` calls under `<userData>/sub-chats/`
- **THEN** none are found outside `atomicWriteArtifact`

### Requirement: Single-writer claim per subChatId; secondary opener is read-only

The main process SHALL maintain an in-memory registry `subChatId → { ownerWindowId, ownerPaneId, claimedAt }`. The first panel that mounts for a given subChatId acquires the claim. Subsequent panels for the same subChatId in any window receive `isOwner=false` and the renderer renders a banner "Already open in another window — actions are read-only here". In the non-owner panel, the Send button, sidebar action buttons (Approve plan, Build plan, Fix review issues), and CLI bootstrap MUST be disabled. Reads (message history, plan/review sidebar, terminal scrollback) MUST remain available.

The non-owner banner MUST include a "Take over here" action. Clicking it revokes the prior claim, transfers ownership to the clicking panel, and the previously-owning panel's banner updates to reflect its new non-owner state.

Claim release is automatic on panel close, owner window close, or app exit. Claims do not persist across app restarts (every restored panel boots non-owner until it acquires).

#### Scenario: Two windows both open the same subChat
- **GIVEN** window A opens subChat X first
- **WHEN** window B opens the same subChat X
- **THEN** window A's panel has `isOwner=true` and full UI
- **AND** window B's panel has `isOwner=false` and shows the read-only banner
- **AND** window B's Send button is disabled

#### Scenario: Take-over transfers ownership
- **GIVEN** window A is the owner and window B is read-only
- **WHEN** the user clicks "Take over here" in window B
- **THEN** window B becomes owner with Send enabled
- **AND** window A's panel banner updates to show it is now read-only

#### Scenario: CLI bootstrap is gated on ownership
- **GIVEN** a `claude-cli` subChat opened in two windows
- **WHEN** the user clicks Reattach in the non-owner window
- **THEN** no PTY is spawned
- **AND** a toast or banner clarifies that ownership is in another window

### Requirement: Hard-reset action per chat panel for every harness

Every chat-panel header SHALL expose a "Hard-reset session" action (menu item or icon button) available regardless of harness. The action's effect is harness-specific but its user promise is constant: after the action completes, the panel is in a clean known state for its harness.

- `builtin` / `builtin + openspecChangeId`: abort all in-flight streams scoped to this subChatId (built-in agent stream and any Codex stream), clear the streaming-status atom, clear pending tool-confirmation prompts, and reload the panel. Message history is left intact.
- `claude-cli` / `codex-cli`: release the single-writer claim, SIGTERM the PTY (escalate to SIGKILL after 2 s), wait for `exit`, then re-run the bootstrap (which rewrites the per-CLI config file with the current bearer/port) and respawn. By default xterm scrollback is preserved; a "Clear scrollback too" checkbox in the confirm dialog wipes it.
- Openspec-editor variant: do the harness reset above **and** call `forceFreshSubChatSession(subChatId)` to bump the session epoch and reset the editor's transient view state.

The action MUST be available even when the panel is in a stuck or unresponsive state (the button must not depend on the agent stream or PTY being healthy).

#### Scenario: Hard-reset built-in aborts streams and keeps history
- **GIVEN** a `builtin` subChat with 5 messages and an in-flight stream
- **WHEN** the user clicks Hard-reset
- **THEN** all in-flight streams for this subChatId are aborted
- **AND** message history still shows the 5 messages
- **AND** the chat status is `idle`

#### Scenario: Hard-reset CLI kills PTY and respawns with fresh bootstrap
- **GIVEN** a `claude-cli` subChat with a hung PTY
- **WHEN** the user clicks Hard-reset
- **THEN** the PTY is signaled SIGTERM, then SIGKILL after 2 s
- **AND** the per-subChat CLI config file is rewritten before respawn
- **AND** a new PTY runs `claude` with the same `subChatId` env
- **AND** xterm scrollback is preserved by default

#### Scenario: Hard-reset is reachable when the panel is unresponsive
- **GIVEN** a panel showing a stuck-session banner due to MCP 5xx errors
- **WHEN** the user clicks Hard-reset
- **THEN** the action runs regardless of whether MCP is currently responsive
- **AND** the banner clears once the reset finishes successfully

### Requirement: Stuck-session detection surfaces a stall icon + advisory banner; the user decides when to restart

The renderer SHALL show a **stall icon** in the chat-panel header (a small warning glyph, distinct from the harness icon defined in `chat-surface-router/spec.md`) whenever any stuck-session heuristic is active for that subChatId. Clicking or hovering the icon expands a non-modal banner whose copy names the triggering heuristic and offers a Hard-reset CTA:

- PTY exit code ≠ 0 within the first 5 s of spawn → "CLI exited immediately — check Claude/Codex installation".
- No PTY output for >60 s while the agent stream is in `streaming` state → "CLI is unresponsive".
- Three consecutive 5xx responses from MCP `read_plan`/`read_review` for this subChatId → "MCP isolation may be broken — try Hard-reset".
- Built-in agent stream silent for >120 s while last server event was `tool_call_in_flight` → "Tool call may be stuck".

The banner MUST include a "Hard-reset session" button that triggers the same action as the header menu item. The banner MUST be dismissable (clicking dismiss hides the banner but does NOT hide the stall icon until the underlying heuristic clears or fires again with a new triggering event). The system MUST NOT auto-reset, auto-respawn, or otherwise act on these heuristics under any circumstances — the **user** decides whether to restart or keep waiting. Thresholds are fixed in code; no settings knob is exposed.

#### Scenario: Stall icon and banner appear when CLI exits immediately
- **GIVEN** a `claude-cli` panel where `claude` exits with code 127 within 1 s of spawn
- **THEN** the chat-panel header shows the stall icon
- **AND** clicking the stall icon expands a banner reading "CLI exited immediately — check Claude/Codex installation"
- **AND** the banner has a Hard-reset CTA
- **AND** the agent process is not respawned automatically

#### Scenario: Stall icon coexists with the harness icon
- **GIVEN** any chat panel with an active stuck-session heuristic
- **THEN** both the harness icon (Claude/Codex/builtin per `chat-surface-router/spec.md`) and the stall icon are visible in the header
- **AND** the two icons are visually distinct and have different `data-testid`s

#### Scenario: Banner dismiss does not hide the stall icon
- **WHEN** the user clicks the X on a stuck-session banner
- **THEN** the banner disappears
- **AND** the stall icon remains visible in the header while the underlying heuristic is still active
- **AND** the banner does NOT auto-reappear for the same triggering event until a new triggering event fires

#### Scenario: No auto-reset under any heuristic
- **GIVEN** all four stuck-session heuristics firing for one subChatId
- **THEN** the stall icon is shown
- **AND** no Hard-reset action runs unless the user explicitly clicks the button
- **AND** no PTY is respawned, no stream is aborted, no automatic action of any kind is taken
