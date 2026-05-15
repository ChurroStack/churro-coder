## Context

### As-is

`apps/desktop` already supports two chat surfaces over a single `chat:*` tRPC router and a single `subChats` row identity:

- **Classic chat** — `apps/desktop/src/renderer/features/agents/main/agents-content.tsx` renders messages from the built-in Claude Agent SDK orchestrator. Plan, review, diffs, and files-tree live as separate dockview side panels.
- **OpenSpec change editor** — `apps/desktop/src/renderer/features/openspec/openspec-change-view.tsx` renders the change's proposal/design/tasks/specs with a chat sidebar on the right.

Selection rule today (in `apps/desktop/src/renderer/features/dock/panels/chat-panel.tsx` ≈ line 118): if `subChat.openspecChangeId` is set, render the openspec editor; otherwise render `AgentsContent`. Both surfaces share the same `chat:*` send path, the same `messages` table, the same plan/review file artifacts under `<userData>/sub-chats/<subChatId>/`, and the same prompt input (`apps/desktop/src/renderer/features/agents/main/chat-input-area.tsx`).

We also already have:

- A robust **terminal feature** with xterm.js + node-pty, exposed via `terminal:*` tRPC procedures (`apps/desktop/src/main/lib/trpc/routers/terminal.ts`) including a `write` mutation that accepts arbitrary stdin data — i.e. a `sendInput` channel exists today, but is only consumed by user keystrokes from the xterm DOM.
- An **MCP server** (`apps/desktop/src/main/lib/mcp/server.ts`) with tools `read_plan`, `read_review`, `write_review`. There is already an HTTP transport that persists `{port, bearer}` to `<userData>/churro-mcp.json` and a per-subchat factory `createMcpServerForSubChat(subChatId)`. Codex bootstrap already reads that file.
- A `Harness` enum in the New Workspace wizard (`apps/desktop/src/renderer/features/agents/lib/wizard-state.ts`) but it currently means *prompt template / mode style* (`vibe-coding | spec-driven`), not *which agent process runs the chat*.

### To-be

Three orthogonal axes drive what the user sees inside a chat panel:

1. `harness` (new column on `subChats`) — `builtin | claude-cli | codex-cli`. Picks which **agent process** drives the chat.
2. `openspecChangeId` (existing column) — picks whether the chat is **about an openspec change** (editor view in the main area) or a free-form chat.
3. `mode` (existing column) — `plan | execute | explore`, builtin-only behavior; native CLIs ignore it (their own slash commands handle equivalent state).

The cross product of (1) and (2) gives the **content surface** rendered inside the chat panel; sidebars (plan, review, diffs, files-tree) and the prompt input are surface-agnostic.

| `harness`     | `openspecChangeId` | Main content area                              | Bottom prompt input dispatches to            | Plan/Review side-panel updates from          |
|---------------|--------------------|------------------------------------------------|-----------------------------------------------|-----------------------------------------------|
| `builtin`     | `null`             | Classic messages (`AgentsContent`)              | Built-in agent send (`chat:send`)              | Built-in orchestrator writes plan/review files |
| `builtin`     | `<id>`             | OpenSpec editor (`OpenSpecChangeView`) + sidebar chat with classic messages | Built-in agent send                            | Built-in orchestrator                         |
| `claude-cli`  | `null`             | Embedded terminal running `claude`              | `terminal:write` with `\n` (slash cmds + prompt) | MCP `write_review` / `write_plan` calls from CLI |
| `claude-cli`  | `<id>`             | OpenSpec editor + **sidebar chat = embedded `claude` terminal** | `terminal:write`                              | MCP calls from CLI                            |
| `codex-cli`   | `null`             | Embedded terminal running `codex`               | `terminal:write`                              | MCP calls from CLI                            |
| `codex-cli`   | `<id>`             | OpenSpec editor + **sidebar chat = embedded `codex` terminal** | `terminal:write`                              | MCP calls from CLI                            |

The sidebar action buttons (Approve plan, Build plan, Fix review issues) compile a deterministic prompt (e.g. `Approve the current plan`) and dispatch it through the same harness-aware path, so they keep working regardless of harness.

### Constraints

- `apps/desktop` is bun-managed; do not pull pnpm in. (AGENTS.md.)
- Drizzle migration must use `--> statement-breakpoint` correctly and have a strictly-greater `when` than the current journal head, or it silently no-ops. (AGENTS.md.)
- We must not break existing chats — backfill `harness='builtin'` and keep all current code paths default.
- `claude` and `codex` CLIs are user-installed; we cannot bundle them. We must fail with an actionable error when they're missing.
- Trace logs at process boundaries (PTY spawn, MCP request, harness bootstrap) per AGENTS.md "Traceability".

## Goals / Non-Goals

**Goals:**

- Add a third type of chat content (embedded native CLI) without forking the `chat:*` router, the `subChats` table, the prompt input, or the sidebars.
- Let users pick the harness from (a) the New Workspace wizard for a fresh workspace, and (b) the dockview "New" menu for ad-hoc panels.
- Keep plan/review/diff side panels updating live regardless of harness, by routing CLI-side writes through the same per-subchat artifact files.
- Make the terminal component good enough to host a real TUI (Claude Code, Codex) — color, encoding, alternate screen, resize, mouse, idle detection, programmatic input.
- Preserve the OpenSpec change editor's sidebar chat as a place where the embedded CLI can also live.

**Non-Goals:**

- Bundling, auto-installing, or auto-updating Claude/Codex CLIs. We discover them on PATH and surface a setup error.
- Adding harnesses other than `builtin`, `claude-cli`, `codex-cli` in this change. The bootstrap layer is structured to allow it later.
- Cross-machine / remote terminal sessions. PTYs remain local to the desktop process.
- Refactoring plan/review sidebar internals. Only their action-button dispatch becomes harness-aware.
- Moving the harness bootstrap into `apps/daemon`. Stays in the Electron main process for now.
- Live mid-stream editing of the running CLI prompt. The "send" path always finalizes a turn with a newline; partial-input UX is out of scope.
- A unified abstraction that hides the difference between agent-message events and raw terminal bytes. The two surfaces stay distinct UI components; only the *router* unifies them.

## Decisions

### D1. Add a `harness` column on `subChats` instead of a separate `chat_kind` table

Adding a single nullable-but-defaulted column keeps the discriminator co-located with `openspecChangeId` (they're queried together every time `ChatPanel` mounts) and avoids a join on the hot path. The column is `TEXT NOT NULL DEFAULT 'builtin'`. Backfill is implicit via the default; existing rows get `'builtin'` on migration. The enum (`'builtin' | 'claude-cli' | 'codex-cli'`) is enforced at the Zod boundary and by the tRPC immutability guard — SQLite cannot ALTER ADD a CHECK without a table rebuild, so the original DB-level CHECK was dropped in favor of the boundary enforcement.

**Alternatives considered:** (a) overloading the existing `mode` column — rejected, mode is per-turn UX state and orthogonal to which process runs; (b) deriving harness from a workspace-level setting — rejected, users want per-chat harness flexibility, especially when comparing two harnesses on the same project; (c) a separate `chat_surfaces` table — rejected as overkill for a 3-value enum that's always read with the parent row.

### D2. UI selection is a renderer-side router; not a server discriminator

`ChatPanel` does the `(harness, openspecChangeId)` switch in the renderer. Server-side, `chat:*` keeps its current shape; only `getSubChat` returns the new `harness` field, and `createSubChat` accepts an optional `harness` (default `'builtin'`). This keeps the change additive and avoids splitting the router into `chat-builtin:*`, `chat-cli:*`.

**Alternatives considered:** splitting routers — rejected; the lifecycle (create, rename, archive, delete, listMessages, plan/review reads) is identical across harnesses and we'd just duplicate.

### D3. Embedded CLI = the existing terminal feature, parameterized by a `bootstrap` blob

Don't write a new "cli-host" component. Instead, formalize a `TerminalBootstrap` record on the server side that says: cwd, env additions, command + args, optional `initialInput`, optional `idleDetection` config. The chat-embedded terminal calls `terminal:createOrAttach` with a bootstrap built from the chat's harness; the standalone "New Terminal" panel calls it with no command (default shell). Same component, same xterm instance, same `write` API.

The chat input's send handler becomes:

```ts
if (harness === 'builtin') agentSend(prompt);
else trpc.terminal.write.mutate({ paneId, data: composedSlashCommandsThenPrompt + '\n' });
```

The "composed slash commands" come from a small adapter per harness (e.g. mode-change requested via `/model opus`), so the user keeps using our existing input UX (mode picker, model picker) and we translate to the CLI's command vocabulary just-in-time.

**Alternatives considered:** building a new wrapper React component per harness — rejected; the only difference is the spawn line and the input adapter.

### D4. MCP server gets a per-request subChatId via env-injected URL path

Today's HTTP transport binds globally and `createMcpServerForSubChat(subChatId)` is selected for the built-in path which has the subChatId in closure. For external CLIs we can't close over it, so:

- Bootstrap injects `CHURRO_SUBCHAT_ID=<id>` into the CLI's env.
- Bootstrap also injects a per-CLI MCP config that points to `http://127.0.0.1:<port>/sub/<subChatId>/` (path-scoped) using the existing bearer token. The `/sub/<id>/` path makes the subChatId explicit in every JSON-RPC request, so the server constructs a `createMcpServerForSubChat(id)` per request — no statelessness compromise on tools, and no risk of one CLI accidentally writing to another subchat's plan.
- For `claude` we write/merge into its config file; for `codex` we use `--mcp-config` (or the equivalent env-based config it supports today). The bootstrap layer owns the binary-specific incantation.

**Alternatives considered:** stateless MCP server with `subChatId` as a tool argument — rejected; the CLIs would have to remember to pass it on every call, and a buggy CLI tool definition could omit it. URL path scoping makes misrouting impossible.

### D5. Idle detection is a server-side heuristic, optional, advisory only

The terminal session emits an `idle` event when no PTY output has been seen for N ms (default 1500ms) **and** the cursor is on a line ending in a known prompt-ish pattern (`> `, `$ `, `❯ `, configurable per harness). The chat input uses this purely to enable the Send button when in CLI mode; user can always send anyway. We do **not** try to interpret CLI semantics (e.g. "agent finished thinking") — that's brittle.

**Alternatives considered:** parsing CLI-specific completion markers — rejected; couples us to undocumented internal output.

### D6. Dockview "New" menu becomes config-driven

Today, panels are added programmatically by feature code; there is no first-class "New" menu enumerating all kinds. We add a tiny registry of `NewMenuEntry { kind, label, icon, defaultPinned }` and a settings key `dock.newMenu.pinned: string[]` that stores which kinds are pinned to the toolbar; everything else lives in an overflow dropdown. Entries: `chat` (builtin), `chat-claude-cli`, `chat-codex-cli`, `terminal`, `openspec-change`. The "kind" includes the harness so a single click bootstraps the right combination.

### D7. New Workspace wizard adds a sibling "Agent" dropdown; existing card selector is untouched

The wizard's existing `vibe-coding | spec-driven` card selector stays exactly as it is today — same component, same labels, same layout, same behavior (it picks classic-vs-openspec and drives the existing prompt/template logic). We do not rename it in the UI.

We **add** a new `agentHarness: 'builtin' | 'claude-cli' | 'codex-cli'` field rendered as a dropdown placed at the same level as the project / worktree / branch selectors (a sibling control, not nested inside the card selector). The wizard persists `lastSelectedAgentHarnessAtom` mirroring the existing `lastSelectedHarnessAtom`. On submit, the agent harness flows into the first subChat's `harness` column. The two axes — surface (cards) and agent process (dropdown) — are fully independent: any combination is valid.

To avoid name collision in the codebase between the existing `Harness` type (cards) and the new agent-harness concept, we rename the existing TypeScript type to `WizardTemplate` as a pure internal cleanup. This is a code-only change with zero user-visible effect; the cards keep their current labels and behavior.

**Alternatives considered:** (a) overload the existing card selector to also list `claude-cli` / `codex-cli` — rejected; the user explicitly wants the cards left alone, and the two axes are conceptually independent; (b) skip the internal type rename and let `Harness` mean two different things in different files — rejected; future readers would conflate them. The rename is small and entirely renderer-internal.

### D8. App-restart restoration strategy: persisted state on disk, PTY respawn lazy + always fresh-bootstrap

Audit of today's code shows:

- Dockview layout + open subChat IDs already persist to `localStorage` (`agents:shell:v3`, per-workspace dock keys, `${windowId}:agent-open-sub-chats-${chatId}`) and rehydrate on boot.
- Built-in chat messages live in SQLite; loading a subChat re-reads them via `chat:getMessages`. In-flight stream state is **not** persisted (last partial token is lost). We codify this as the intended contract for built-in chats — no change.
- Terminals (`apps/desktop/src/main/lib/terminal/`) do **not** persist PTY processes, but **do** persist xterm scrollback to `<userData>/terminal-history/<workspaceId>/<paneId>.txt`. `setupInitialCommands` only fires on new sessions, not reattach.
- MCP HTTP server binds to a fresh `{port, bearer}` on every app boot and writes them to `<userData>/churro-mcp.json`. Any pre-written CLI config file (Claude config edit, Codex `--mcp-config` file) becomes **stale** the moment the app restarts.

Decision:

- For `harness='builtin'` (and `'builtin' + openspecChangeId`): restoration is automatic via the existing path. We add no resume mechanism for in-flight streams.
- For `harness='claude-cli' | 'codex-cli'`: the panel restores in a "disconnected" state. The CLI is **not** auto-spawned at app boot — we wait until the panel becomes the active tab in its dock group, then run the bootstrap exactly as if the panel had just been created, **always overwriting** `<userData>/cli-bootstrap/<subChatId>.<harness>.<ext>` with the current bearer/port so the CLI can never reach the dead previous-session MCP. xterm scrollback is restored from history file so the visual context is preserved while the new PTY warms up.
- **Restart of a CLI subChat is always a cold restart.** We do not attempt to capture a CLI session id from TUI output and we do not pass `--resume`/equivalent flags. Rationale: parsing TUI stdout for a stable session token is unreliable (the TUI uses alternate-screen mode, redraws frequently, may not log a session id at all, and the format is unspecified across CLI versions). The cost of being wrong (passing a stale or fabricated id) is corrupted CLI state; the cost of being right is duplicating what MCP already gives us for free. We accept the tradeoff: the CLI's internal conversation buffer is lost on restart, but the per-subChat **plan, review, and any other artifact files written via MCP survive** under `<userData>/sub-chats/<id>/`. On reattach, the user's first prompt to the new CLI session can simply ask "read the current plan and continue" — the MCP `read_plan`/`read_review` tools give the new session everything it needs to re-orient. This is documented in the in-panel reattach banner so the user understands the contract.

**Alternatives considered:** (a) auto-spawn every CLI panel at boot — rejected; users restoring a workspace with 6 CLI panels would pay 6× CLI startup tax even if they only care about one panel; (b) ask the user via a modal "Resume / Start fresh / Stay disconnected" per panel — rejected; too much friction for the common case. The lazy-on-activate path makes the cost match the user intent, and the visible "Reattach" banner gives them an explicit choice if they want it; (c) keep PTYs alive across restart via a sidecar process — rejected as out-of-scope for this change (would belong in `apps/daemon`, see proposal exclusions).

### D9. Single-writer claim per subChatId; second opener is read-only with a banner

Today, two windows could both open the same subChatId and both panels could try to send messages or both could see plan-file writes. The sub-chat-store has cross-workspace guards but they are warn-only. With CLIs in the mix, two PTYs pointing at the same `CHURRO_SUBCHAT_ID` would race on plan/review writes through MCP, which is unsafe.

Decision: introduce a tiny in-memory **claim registry** in the main process keyed by `subChatId → { ownerWindowId, ownerPaneId, claimedAt }`. The first panel to render a subChat takes the claim; later panels see `subChat.isOwner === false` and the renderer renders a banner ("Already open in window N — actions are read-only here") and disables Send / sidebar action buttons. The claim is released when the owner panel closes, the owner window closes, or the user explicitly clicks "Take over here" on the secondary banner (which revokes the prior claim and notifies the previous owner with the same banner).

We deliberately keep this **in-process only** — the claim does not survive an app restart, and we do not coordinate across machines. Surviving restart is unnecessary because all panels boot disconnected and the first one to activate naturally re-claims.

**Alternatives considered:** (a) file-system lock at `<userData>/sub-chats/<id>/.lock` — rejected; survives restart and requires cleanup of stale locks (the AGENTS.md note about `.broken-*` quarantine files is exactly the same kind of trap); (b) hard-reject the second opener — rejected; user may legitimately want to peek at history in another window; (c) merge writes — rejected; we'd be inventing CRDTs over markdown files. Soft single-writer with a clear banner is the smallest thing that prevents the race.

### D10. Atomic 3-phase write for plan/review artifact files

`<userData>/sub-chats/<id>/plans/current.md` + `current.meta.json` and the equivalent under `reviews/` are today written as `write tmp → rename`. Crash between the two renames (current.md is new, meta is old) is observable, and there is no `fsync` before rename so even a single-file rename can yield a zero-length `current.md` on power loss.

Decision: every artifact write goes through `atomicWriteArtifact(path, body)`:

1. Write to `<path>.tmp` (open, write, `fsync`, close).
2. `rename(<path>.tmp, <path>)`.
3. Write `<path>.meta.json` *after* the body rename completes, also tmp-fsync-rename.
4. On app boot, sweep `<userData>/sub-chats/*/{plans,reviews}/` for orphan `*.tmp` files and unlink them with a trace.

This means readers can always trust that `current.md`'s body is fully on disk before `current.meta.json` reflects a newer revision number. Readers that see a meta with a revision newer than current.md treat current.md as still-current (defensive). The MCP `read_plan` / `read_review` tools and the renderer file watcher both read body-first / meta-second.

**Alternatives considered:** (a) SQLite-backed plan/review storage — rejected; existing CLI users can `cat` the markdown and reviewers like having files; (b) ignore the race — rejected; this is precisely the kind of silent data-loss bug AGENTS.md warns about for the migration journal.

### D11. Hard-reset action per chat panel; stuck-session detection is advisory

A single "Hard-reset session" menu item in the chat-panel header acts differently per harness but has one user-visible promise: *after the action, this panel is in a clean known state*.

- `builtin`: call `abortAllClaudeSessions(subChatId)` + `abortAllCodexStreams(subChatId)`, clear the streaming-status atom, clear any pending tool-confirmation prompts, then reload the panel. Message history is left intact.
- `claude-cli` / `codex-cli`: revoke the claim, dispose the xterm instance (keeping scrollback file or clearing it per a confirmation toggle), SIGTERM the PTY (escalate to SIGKILL after 2s, same logic that exists today on app quit), wait for `exit`, then re-run the bootstrap from scratch (which rewrites the per-CLI config file with the current bearer/port) and respawn.
- Openspec-editor variant: same as the harness above, plus call `forceFreshSubChatSession(subChatId)` to bump the session epoch and drop the editor's transient view-state.

Stuck-session detection is a **non-blocking advisory layer**, not a watchdog that auto-kills. Heuristics:

- PTY exit code ≠ 0 within the first 5s of bootstrap → assume binary-missing / config-invalid; banner: "CLI exited immediately — check Claude/Codex installation".
- No PTY output for >60s while the stream is in `streaming` state → banner: "CLI is unresponsive".
- Three consecutive 5xx responses from MCP `read_plan`/`read_review` for this subChatId → banner: "MCP isolation may be broken — try Hard-reset".
- Built-in agent stream silent for >120s while last server event was `tool_call_in_flight` → banner: "Tool call may be stuck".

The banner is always non-modal. The Hard-reset CTA is the same action that lives in the header menu. **We do not auto-reset**, because false positives during legitimate long-running operations (e.g. a CLI running a big test suite) would destroy in-progress work.

**Alternatives considered:** (a) global "Restart all sessions" button — rejected; blast radius is too large and the existing Cmd+Shift+R force-reload covers true nuclear cases; (b) auto-reset when stuck-detection fires — rejected per the false-positive concern; (c) restart the entire app on stuck CLI — rejected; sledgehammer for a scoped problem.

## Risks / Trade-offs

- **CLI-version drift breaks slash-command translation** → Mitigation: the input adapter is per-harness and version-detected on bootstrap; if a slash command isn't supported we fall through and send only the prompt body, with a warning trace.
- **TUI rendering glitches inside an embedded panel that the standalone terminal doesn't show** → Mitigation: reuse the *same* terminal component, same xterm options, same renderer (WebGL with canvas fallback). Add a smoke test that runs `claude --help` and `codex --help` inside the embedded terminal and asserts no console errors and a non-empty serialized buffer.
- **MCP per-request subChatId scoping requires URL path support** → Mitigation: existing HTTP transport is a small Node http server we control; adding path-prefix routing is a few lines. We keep the legacy root route working for the in-process built-in path during transition, then deprecate.
- **Plan/review file races between CLI MCP writes and built-in writes** → Mitigation: a chat is single-harness for its lifetime — once `harness='claude-cli'`, only the CLI writes; once `'builtin'`, only the orchestrator writes. We do not allow switching harness mid-chat in this change (UI gates it; a future change can lift the restriction with a proper merge strategy).
- **Bearer token in env may leak via `ps`/process-info APIs** → Mitigation: bearer is short-lived (regenerated on app start) and bound to 127.0.0.1 only; we pass via config file path, not env, when the CLI supports it.
- **Idle-detection heuristic gives false negatives** (Send stays disabled when CLI is actually idle) → Mitigation: Send is only *advisory-disabled*; user can always force-send via the existing Force-Send affordance. We log idle decisions for tuning.
- **Bun-only desktop install + node-pty native rebuild** for any new dependency → Mitigation: prefer libraries already in the desktop tree (xterm.js, node-pty, undici/node http); avoid adding new native deps.
- **Two openspec sidebars displaying terminal output vs messages may look surprising** → Mitigation: a small badge on the sidebar header indicates the harness ("Claude CLI"); same prompt input semantics so muscle memory transfers.
- **Migration journal date error silently no-ops the migration** → Mitigation: explicit pre-merge checklist item in tasks.md and a unit-test scaffold that boots the schema and asserts the new column exists.
- **Stale CLI config files after app restart point an external CLI at a dead MCP port/bearer** → Mitigation per D8: bootstrap *always* overwrites `<userData>/cli-bootstrap/<subChatId>.<harness>.<ext>` at every spawn, never reuses a prior session's file. A regression test boots twice in a row with a CLI panel restored and asserts the config file mtime is post-second-boot.
- **Single-writer claim is in-memory only — two app processes (two installs, dev + packaged) could both claim** → Mitigation: scope is documented as "in-process per app process". This is the same boundary as everything else in the desktop app (the SQLite DB itself is single-process-locked by `better-sqlite3`). If the user truly runs two app processes against the same `<userData>`, both will fail to acquire the DB lock anyway, so the claim never has to deal with that case.
- **Plan/review file atomic write still loses revisions on power loss between rename and the next write** → Acceptable: we lose the *new* revision, not corrupt the prior one. Readers see the prior `current.md` consistently and the renderer's file watcher fires when the next successful write lands. This is a sharply scoped data-loss window (single failed write) vs. the current footgun (partial files, mismatched meta).
- **Stuck-session detection false-positives interrupt the user's flow with banners** → Mitigation per D11: banner is advisory only and dismissable; thresholds chosen conservatively (60s PTY silence, 120s built-in stream silence, 3 consecutive MCP 5xxs). Telemetry-friendly trace `[stuck-detect] subChat=<id> reason=<kind>` so we can tune thresholds.
- **Hard-reset of a CLI session loses internal CLI context** (conversation history inside `claude`) → Mitigation per D8: we accept this as the price of recovery. The plan, review, and other per-subChat artifact files written via MCP survive the reset on disk, so the user can re-orient the new CLI session with a "read the current plan and continue" prompt. We do **not** attempt to parse a session id out of TUI output and pass `--resume` — that path is too fragile (see D8 rationale). The reattach/hard-reset banner copy makes this contract explicit so users aren't surprised.
- **Orphan `.tmp` sweep at boot could race with a concurrent write from a long-lived previous process** → Not possible: SQLite + the single-process model means we sweep only after the new process holds the DB lock, by which point the prior process is gone.

## Migration Plan

1. Ship the `subChats.harness` migration with default `'builtin'`. No behavior change.
2. Ship the renderer surface router and harness-aware input dispatch behind no flag — `'builtin'` paths are byte-identical, the new branches are unreachable until the dock-new-menu / wizard UI lands.
3. Ship the terminal `bootstrap` + idle detection refactor; the standalone terminal continues to work with empty bootstrap.
4. Ship the MCP HTTP `/sub/<id>/` routing alongside the existing root route; built-in path stays on root.
5. Ship the CLI harness bootstrap (binary discovery + config injection) and the new dock-new-menu entries.
6. Ship the New Workspace wizard "Agent" dropdown.
7. Roll-back strategy: each step is independently revertible; the migration is forward-compatible (older app code reading rows with `harness='builtin'` still works because the column has a default and the renderer just ignores unknown values).
8. Ship the resilience layer (D8–D11) — atomic write helper + orphan-`.tmp` sweep first (safe everywhere, no UI impact), then single-writer claim registry, then hard-reset action in the chat panel header, then stuck-session detection banners. Each is independently revertible.
9. After D8 lands, the CLI bootstrap config file path moves to `<userData>/cli-bootstrap/<subChatId>.<harness>.<ext>` and the on-spawn overwrite becomes mandatory. Existing config files (if any) are deleted on next spawn — not migrated — because they reference dead bearers.

## Open Questions

- Q1: Do we want a "switch harness" action on an existing subChat, or strictly enforce single-harness-for-life? (Current decision: enforce; revisit if users ask.)
- Q2: For the openspec editor's *sidebar chat*, when the harness is a CLI, should the sidebar action buttons (Approve plan / Apply / Archive) translate to slash commands (e.g. `/openspec:apply`) or send a free-text instruction the CLI's tool definition will interpret via MCP? Recommend: free-text + MCP, because slash commands aren't standardized across CLIs.
- Q3: Should the daemon (`apps/daemon`) eventually own CLI-harness lifecycle so the desktop app can attach to long-running CLI sessions across restarts? Out of scope here, but tasks.md should leave a `// TODO(daemon)` boundary.
- Q4: `xterm.js` mouse mode has occasional pasteboard interactions on macOS; do we need an explicit allowlist of TUI features per harness? Recommend: ship with full mouse mode on, monitor.
- Q5: ~~Do `claude` and `codex` print a stable session id we can capture from stdout for resume?~~ **Resolved (decision 2026-05-15)**: we do not trust TUI output as a state source. CLI restart is **always** a cold restart. We drop the `harnessResumeKey` column and the `--resume` flag wiring. Recovery continuity is delivered via MCP-resident state instead (plan/review/etc files survive on disk; the new CLI session re-orients on first prompt). This simplifies D8 and removes a whole class of brittle parsers.
- Q6: Should hard-reset of a CLI panel default to *keeping* xterm scrollback (less surprising) or *clearing* it (clean slate)? Recommend: keep by default, with a "Clear scrollback too" checkbox in the confirm dialog.
- Q7: ~~For stuck-session detection, should we let users tune thresholds in settings?~~ **Resolved (decision 2026-05-15)**: no settings knob, no auto-restart, ever. When a stuck-detection heuristic fires, the chat panel header SHALL show a **stall icon** (a small warning/spinner glyph distinct from the harness icon from the chat-surface-router spec). Hovering or clicking it reveals the heuristic's message and the Hard-reset CTA. The user — never the app — decides whether to restart or keep waiting. Thresholds stay fixed in code; we revisit only if telemetry shows the stall icon is consistently wrong.
- Q8: Should the orphan-`.tmp` sweep at boot run before or after the migration step? Recommend: after — the migration may itself create per-subchat directories, and we want to sweep with the final shape of `<userData>/sub-chats/`.
