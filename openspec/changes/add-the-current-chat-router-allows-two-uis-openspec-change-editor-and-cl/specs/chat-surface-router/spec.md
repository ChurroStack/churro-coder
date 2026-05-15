## ADDED Requirements

### Requirement: Chat panel selects content surface from `(harness, openspecChangeId)`

The desktop chat panel SHALL render exactly one of three content surfaces inside its main area, chosen deterministically from the subChat's `harness` and `openspecChangeId` columns. Sidebars (plan, review, diffs, files-tree) and the bottom prompt input MUST remain mounted regardless of which surface is selected.

The selection table is:

| `harness`     | `openspecChangeId` | Main content surface                                         |
|---------------|--------------------|--------------------------------------------------------------|
| `builtin`     | `null`             | Classic messages (built-in agent)                            |
| `builtin`     | `<id>`             | OpenSpec change editor + sidebar with classic messages       |
| `claude-cli`  | `null`             | Embedded terminal hosting the `claude` CLI                   |
| `claude-cli`  | `<id>`             | OpenSpec change editor + sidebar with embedded `claude` CLI  |
| `codex-cli`   | `null`             | Embedded terminal hosting the `codex` CLI                    |
| `codex-cli`   | `<id>`             | OpenSpec change editor + sidebar with embedded `codex` CLI   |

Future harness values MUST extend this table without changing the rule shape.

#### Scenario: Built-in chat, no openspec change
- **WHEN** a chat panel mounts a subChat where `harness='builtin'` and `openspecChangeId IS NULL`
- **THEN** the main area renders the classic message list and the sidebar slot is empty

#### Scenario: Built-in chat tied to an openspec change
- **WHEN** a chat panel mounts a subChat where `harness='builtin'` and `openspecChangeId` is set
- **THEN** the main area renders the OpenSpec change editor
- **AND** the sidebar renders the classic message list bound to the same `subChatId`

#### Scenario: Claude CLI chat, no openspec change
- **WHEN** a chat panel mounts a subChat where `harness='claude-cli'` and `openspecChangeId IS NULL`
- **THEN** the main area renders an embedded terminal whose PTY is bootstrapped with the `claude` CLI

#### Scenario: Codex CLI chat tied to an openspec change
- **WHEN** a chat panel mounts a subChat where `harness='codex-cli'` and `openspecChangeId` is set
- **THEN** the main area renders the OpenSpec change editor
- **AND** the sidebar renders an embedded terminal hosting the `codex` CLI bootstrapped for that subChat

### Requirement: Prompt input dispatches based on harness

The bottom prompt input SHALL stay visually identical across all surfaces. On Send, it MUST dispatch through one of two paths chosen by the active subChat's `harness`:

- `harness='builtin'` → existing built-in agent send (`chat:send`-style mutation).
- `harness IN ('claude-cli','codex-cli')` → `terminal:write` against the chat's embedded PTY pane, sending the composed payload followed by a single trailing `\n`.

The composed payload MUST be the concatenation of any per-harness slash-command translations (e.g. mode change → `/model opus\n`) followed by the user's prompt text. If a translation is unsupported by the detected CLI version, that translation MUST be skipped and a trace logged; the prompt body MUST still be sent.

#### Scenario: Built-in send unchanged
- **WHEN** the user clicks Send in a `harness='builtin'` chat
- **THEN** the request goes through the existing built-in agent send path
- **AND** no `terminal:*` mutation is invoked

#### Scenario: CLI send pipes to terminal stdin
- **WHEN** the user clicks Send in a `harness='claude-cli'` chat with prompt text "do the thing"
- **THEN** the renderer calls `terminal:write` with `data` ending in `\n` for the chat's PTY pane

#### Scenario: Mode change before prompt translates to slash command
- **WHEN** the user changes mode to "opus" and sends "refactor X" in a CLI-backed chat
- **THEN** the data written to the terminal MUST be `/model opus\nrefactor X\n` (or the per-harness equivalent)

#### Scenario: Unsupported slash translation is skipped
- **WHEN** the per-harness adapter has no mapping for the requested mode change
- **THEN** the prompt body alone is sent with a single trailing `\n`
- **AND** a trace log records the skipped translation with the harness id

### Requirement: Sidebar action buttons honor harness dispatch

Plan and review sidebar action buttons (e.g. Approve plan, Build plan, Fix review issues) SHALL use the same harness-aware dispatcher as the prompt input. They MUST NOT call the built-in agent send directly when the active subChat is on a CLI harness; instead they MUST translate to the per-harness CLI input (free-text instruction or slash command) routed through `terminal:write`.

#### Scenario: Approve plan in CLI-backed chat
- **WHEN** the user clicks "Approve plan" in a `harness='claude-cli'` chat
- **THEN** the corresponding instruction is sent via `terminal:write` with a trailing `\n`
- **AND** no built-in agent mutation is invoked

#### Scenario: Approve plan in built-in chat (regression guard)
- **WHEN** the user clicks "Approve plan" in a `harness='builtin'` chat
- **THEN** the existing built-in agent path is used unchanged

### Requirement: Harness is immutable for the lifetime of a subChat

Once a subChat row is created with a given `harness`, the value MUST NOT change for any reason. The rule has three enforcement layers:

1. **Server (tRPC)**: every mutation that touches `subChats` MUST reject any input that attempts to set `harness` on an existing row, returning an explicit error whose message names the rule (e.g. `"subChats.harness is immutable for the lifetime of the subChat"`). The DB-update statement used by mutations MUST exclude the `harness` column from its SET clause; even if a future caller supplies it, the column is never written.
2. **UI**: no surface in the renderer MAY offer a harness-switch affordance — no dropdown, no settings page toggle, no context-menu item, no programmatic flow. The dock "New" menu and the New Workspace wizard are the only entry points where harness is *chosen*, and they only do so for **new** subChat rows.
3. **Documentation**: switching agents for the same conversation requires creating a new subChat. The UI MAY offer a "Clone as Claude CLI" / "Clone as Codex CLI" affordance later, but that always produces a *new* `subChatId` and never mutates the source.

This rule is what makes the per-subChat plan/review write-arbiter decision safe (only the chosen harness writes; no merge logic needed) and what makes the MCP path-scoped routing trustworthy.

#### Scenario: Mutation attempt rejected
- **WHEN** any tRPC mutation tries to update `subChats.harness` for an existing row
- **THEN** the call returns an error whose message names the immutability rule
- **AND** the row is unchanged in the database
- **AND** a trace `[harness-immutable] reject subChat=<id> attempted=<value>` is emitted

#### Scenario: No harness-switch UI exists
- **WHEN** the renderer codebase is grepped for harness-switch affordances (dropdown bound to `harness` for an existing subChat, settings toggle that writes `harness`, etc.)
- **THEN** none are found
- **AND** the dock "New" menu and New Workspace wizard set `harness` only on **create**

#### Scenario: Clone-as-CLI produces a new row, not a mutation
- **WHEN** a future "Clone as Claude CLI" action runs on a `builtin` subChat
- **THEN** a brand-new `subChatId` is created with `harness='claude-cli'`
- **AND** the source row's `harness` is unchanged
- **AND** the user sees two distinct chat panels

### Requirement: Chat tab and panel header carry a per-harness identifier icon

Every chat panel's dockview tab title AND its in-panel header SHALL display a distinct identifier icon (or icon + short label) chosen from the row's `harness`, so users can tell at a glance which agent process drives a given chat without opening it. The mapping is:

- `harness='builtin'` → the existing built-in chat icon (no change from today).
- `harness='claude-cli'` → the Claude icon/logo.
- `harness='codex-cli'` → the Codex icon/logo.

The icon MUST be visible in (a) the dockview tab strip, (b) the in-panel header, (c) the dock "New" menu entries that create that harness, (d) the New Workspace wizard's Agent dropdown options. The icon's `data-testid` MUST be stable per harness so component tests can assert it.

Future harnesses MUST add a new mapping entry rather than reusing an existing icon.

#### Scenario: Claude CLI chat tab shows Claude icon
- **WHEN** a `harness='claude-cli'` subChat is open in the dock
- **THEN** the tab shows the Claude icon next to the title
- **AND** the in-panel header shows the same Claude icon

#### Scenario: Codex CLI chat tab shows Codex icon
- **WHEN** a `harness='codex-cli'` subChat is open in the dock
- **THEN** the tab shows the Codex icon next to the title
- **AND** the in-panel header shows the same Codex icon

#### Scenario: Built-in chat shows the classic icon (regression guard)
- **WHEN** a `harness='builtin'` subChat is open
- **THEN** the tab and header show the existing built-in chat icon unchanged from today
- **AND** no Claude or Codex icon appears anywhere on the panel

#### Scenario: Icon mapping is one-to-one
- **WHEN** the icon registry is enumerated
- **THEN** each harness key maps to exactly one icon and no two harness keys share an icon

### Requirement: Persisted `harness` defaults to `builtin` and is part of `getSubChat`

The `subChats` table SHALL gain a `harness` column with type TEXT, NOT NULL, DEFAULT `'builtin'`. The enum (`'builtin' | 'claude-cli' | 'codex-cli'`) SHALL be enforced at the Zod boundary of every `subChats` mutation and by the tRPC immutability guard on UPDATE — SQLite cannot add a CHECK to an existing table without a full rebuild, so the DB-level CHECK from earlier drafts was dropped in favor of the boundary enforcement. The `chat:getSubChat` query MUST include the field. The `chat:createSubChat` mutation (or its current equivalent) MUST accept an optional `harness` input that defaults to `'builtin'`.

#### Scenario: Pre-existing rows backfill to builtin
- **WHEN** the migration runs against a database with existing subChats
- **THEN** every existing row has `harness='builtin'` and no behavior changes

#### Scenario: New subChat omits harness
- **WHEN** a client creates a subChat without specifying `harness`
- **THEN** the row is persisted with `harness='builtin'`

#### Scenario: New subChat with explicit CLI harness
- **WHEN** a client creates a subChat with `harness='claude-cli'`
- **THEN** the row is persisted with that value
- **AND** `chat:getSubChat` returns it on the response payload

#### Scenario: Invalid harness rejected
- **WHEN** a client creates a subChat with `harness='gemini-cli'` (not in the enum)
- **THEN** the mutation fails validation before reaching the database

### Requirement: Harness persists through dockview panel re-mounts

A chat panel's selected content surface MUST be deterministic from the persisted `subChats.harness` column across the panel's entire lifetime in the dockview, including every event that causes the panel React tree to unmount and re-mount: drag-and-drop within or across groups, tear-out into a new window, the dockview layout deserialization that runs on app boot, and any future dockview-driven reflow.

Concretely:

- The renderer-side panel-entity object that backs dockview `params` for a chat panel MUST include a `harness` field of the same enum as the DB column. Without this, dockview cannot round-trip the harness through a serialize/deserialize or a re-mount, and the panel falls back to whatever the renderer's eventual-consistency stores happen to hold (which, for `'builtin'` defaults and freshly-created CLI subChats, can be wrong).
- Every site that constructs a chat panel entity for `addOrFocus`/`addPanel` MUST populate `harness`. This includes the dock new-menu actions (`newSubChat`, `newSubChatWithHarness`), the chat-panel-sync hydration path, and any future entry point.
- On mount, `ChatPanel` MUST treat `params.harness` as the authoritative source for the surface-router branch when present. The default-to-`'builtin'` fallback is reserved for the truly-unknown case (no `params.harness` AND no row in the store/query). The fallback MUST NOT fire while the store/query is still loading if `params.harness` is set.
- The local store that mirrors subChat metadata in the renderer MUST persist the harness for **every** harness value (including `'builtin'`), so a later remount where `params.harness` is absent still resolves correctly from the store.

#### Scenario: CLI panel survives drag-drop within the same window
- **WHEN** a `claude-cli` panel is drag-dropped from one dockview group to another in the same window
- **THEN** the panel re-mounts and the main area renders the same `ChatCliSurface`
- **AND** the harness icon in both the dockview tab and the in-panel header remains `claude-cli`
- **AND** the classic built-in `AgentsContent` surface does NOT appear in the DOM at any point during or after the transition

#### Scenario: CLI panel survives tear-out into a new window
- **WHEN** a `codex-cli` panel is torn out of its current dockview into a new window
- **THEN** the new window mounts the panel with the same `ChatCliSurface` from its first render
- **AND** no transient builtin surface flashes before the CLI surface appears

#### Scenario: CLI panel survives layout deserialization on app boot
- **WHEN** the app boots and dockview restores a previously saved layout containing a `claude-cli` panel
- **THEN** the panel mounts directly into `ChatCliSurface` from the first render — no builtin flash, no harness icon swap
