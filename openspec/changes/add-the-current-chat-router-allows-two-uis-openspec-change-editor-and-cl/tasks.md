## 1. Schema and tRPC plumbing for `harness`

- [x] 1.1 Add `harness` column to `subChats` in `apps/desktop/src/main/lib/db/schema/index.ts` (TEXT NOT NULL DEFAULT 'builtin' with CHECK constraint over `('builtin','claude-cli','codex-cli')`).
- [x] 1.2 Generate Drizzle migration; verify (a) `--> statement-breakpoint` separator on its own line between every statement and (b) `when` in `drizzle/meta/_journal.json` is strictly greater than the current head.
- [ ] 1.3 Boot the app once with a fresh DB and once with a pre-existing DB to confirm migration applies cleanly and existing rows backfill to `'builtin'`. Watch for `.broken-*` quarantine files.
- [x] 1.4 Update `chat:getSubChat` selection to include `harness`. Update `chat:createSubChat` (or the equivalent create path used by the wizard / dock new menu) to accept optional `harness` defaulting to `'builtin'` with a Zod enum.
- [x] 1.5 Enforce the immutable-harness rule per `specs/chat-surface-router/spec.md` across three layers: (a) every tRPC mutation that touches `subChats` MUST reject input that sets `harness` on an existing row with an error whose message names the rule and emit a `[harness-immutable]` trace; (b) the DB UPDATE statement used by all subChat mutations MUST exclude `harness` from its SET clause so an accidental future call can never write it; (c) grep the renderer for any UI affordance that would let a user switch harness on an existing subChat (dropdown bound to `harness`, settings toggle, context-menu item) and assert there are none. Add focused tests for all three layers.
- [x] 1.6 Add a smoke test that boots the schema, inserts subChats with each harness value, and asserts a CHECK violation for `'gemini-cli'`.

## 2. Renderer: chat surface router

- [x] 2.1 Extend `subChat` types in the renderer to carry `harness`. Make sure the `useSubChat`-style hook returns it.
- [x] 2.2 In `apps/desktop/src/renderer/features/dock/panels/chat-panel.tsx`, replace the current `openspecChangeId` branch with the full `(harness, openspecChangeId)` switch from `specs/chat-surface-router/spec.md`. Keep sidebars and the bottom prompt input outside the switch.
- [x] 2.3 Add a new chat content component `ChatCliSurface` that mounts the embedded terminal (re-using the standalone terminal component) with `bootstrap` derived from `harness`+`subChatId`.
- [x] 2.4 In the openspec editor sidebar slot, render `ChatCliSurface` when `harness IN ('claude-cli','codex-cli')`; otherwise render the existing classic-messages sidebar.
- [x] 2.5 Add a per-harness identifier icon to the dockview chat tab AND the in-panel header per `specs/chat-surface-router/spec.md` ("Chat tab and panel header carry a per-harness identifier icon"). Map: `builtin` → existing built-in chat icon; `claude-cli` → Claude logo; `codex-cli` → Codex logo. Centralize the mapping in one tiny registry module (e.g. `apps/desktop/src/renderer/features/agents/lib/harness-icons.ts`) so the dock new-menu entries (§7), the wizard agent dropdown options (§8), the chat tab, and the chat header all read from the same source. Each icon MUST have a stable `data-testid` (`harness-icon-builtin` / `harness-icon-claude-cli` / `harness-icon-codex-cli`). Source the Claude and Codex assets from the existing brand assets in the repo if present; otherwise add SVGs under `apps/desktop/src/renderer/assets/harness-icons/`.
- [x] 2.6 Snapshot/component test for the router covering all 6 cells in the parameter table.

## 3. Renderer: harness-aware input dispatcher

- [x] 3.1 Refactor `apps/desktop/src/renderer/features/agents/main/chat-input-area.tsx` so that Send goes through a `useHarnessSendDispatcher(subChatId)` hook.
- [x] 3.2 Implement the dispatcher: if `harness==='builtin'`, call the existing agent-send path; otherwise compose `<slash translations>\n<prompt body>\n` and call `terminal:write`.
- [x] 3.3 Move plan/review sidebar action buttons (Approve plan, Build plan, Fix review issues) onto the same dispatcher; delete any direct calls to the built-in agent send from those buttons.
- [x] 3.4 Unit-test the dispatcher with mocked tRPC for: builtin send, CLI send with prompt only, CLI send with translated mode change, CLI send with adapter that returns no translation (skip + trace).
- [x] 3.5 Add an "advisory disabled" Send-button state driven by the terminal idle event; ensure force-send still works regardless.

## 4. Server: terminal `bootstrap` and idle detection

- [x] 4.1 Extend `terminal:createOrAttach` Zod input to accept an optional `bootstrap` of shape `{ cwd?, command?, args?, env?, initialInput?, idleDetection? }`. Default `command` to user shell when omitted.
- [x] 4.2 Implement `initialInput` writing: after PTY spawn, wait for the first stdout chunk OR a 250ms ceiling, then write `initialInput` once.
- [x] 4.3 Implement idle detection: a per-session timer + last-line-pattern check; emit an advisory `idle` event consumable through a new tRPC subscription `terminal:idle`.
- [x] 4.4 Confirm SIGWINCH/resize already propagates from `terminal:resize` to the PTY; add a regression test.
- [x] 4.5 Confirm xterm options for embedded use match the standalone use; centralize options in one helper.
- [x] 4.6 TUI smoke test: spawn `printf '\\e[?1049h\\e[2J\\e[H\\e[?1049l'` (alternate-screen enter/exit) via the bootstrap and assert the terminal returns to the prior buffer.

## 5. Server: MCP path-scoped routing

- [x] 5.1 Update `apps/desktop/src/main/lib/mcp/http-transport.ts` to route `/sub/<subChatId>/...` to `createMcpServerForSubChat(<subChatId>)`. Keep root route as-is.
- [x] 5.2 Validate the bearer on every route (root + path-scoped). Return 401 on mismatch with no body details.
- [x] 5.3 Reject `/sub/<id>/` requests where `<id>` is not a known subChatId with a structured JSON-RPC error; log a trace including the offending id and source IP (loopback only anyway).
- [x] 5.4 Add an integration test using undici/fetch that hits `/sub/<id>/` with the bearer, calls a tool that touches the per-subchat plan/review files, and asserts only that subchat's directory was written.

## 6. Server: CLI harness bootstrap

- [x] 6.1 Create `apps/desktop/src/main/lib/cli-harness/` with `index.ts` exporting `buildBootstrap(harness, subChatId): Promise<TerminalBootstrap | { error }>`.
- [x] 6.2 Implement binary discovery (`PATH` lookup with version probe). Cache results per app session.
- [x] 6.3 Implement Claude CLI config injection: read existing user config, merge an MCP server entry pointing at `http://127.0.0.1:<port>/sub/<subChatId>/` with the current bearer; write atomically.
- [x] 6.4 Implement Codex CLI config injection: write a temp `--mcp-config` file under `<userData>/cli-bootstrap/<subChatId>.codex-mcp.json` and pass `--mcp-config <path>` in args.
- [x] 6.5 Inject `CHURRO_SUBCHAT_ID=<subChatId>` into env for both harnesses.
- [x] 6.6 On binary-missing, return a typed error `{ kind: 'binary-missing', binary, hint }`. The renderer renders this in the chat panel with a Retry action.
- [x] 6.7 Add traces at boundaries: bootstrap start, bootstrap success (with pid + binary path), bootstrap failure (with reason). No bearer, no prompt body.

## 7. Renderer: dockview "New" menu + settings

- [x] 7.1 Create a `newMenuRegistry` with the 5 entries from `specs/dock-new-menu-customization/spec.md`. Include `defaultPinned` per entry.
- [x] 7.2 Add the toolbar component that reads `dock.newMenu.pinned` setting and renders pinned entries as icons + non-pinned in an overflow dropdown. Wire each entry's onClick to a small handler that creates the right subChat (with `harness`) and adds the panel.
- [x] 7.3 Add a settings page section "Dock New Menu" with checkboxes per entry that mutate `dock.newMenu.pinned`.
- [x] 7.4 Persist the setting through the existing settings store; default to `defaultPinned` flags on first read.
- [x] 7.5 Component test covering: clicking each entry creates the right subChat row, and pinning/unpinning moves entries between toolbar and dropdown.

## 8. Renderer: New Workspace wizard agent dropdown

- [x] 8.1 Confirm the `vibe-coding | spec-driven` card selector component is left strictly unchanged (no JSX, label, or behavior edits). Add a snapshot test for the card component to lock its current rendering.
- [x] 8.2 Internal-only rename: `Harness` (cards axis) → `WizardTemplate` in `apps/desktop/src/renderer/features/agents/lib/wizard-state.ts` and all consumers. Keep every user-facing label unchanged. TypeScript build must remain green and no tested visual snapshot may diff.
- [x] 8.3 Add `agentHarness: 'builtin' | 'claude-cli' | 'codex-cli'` to the wizard state with a `lastSelectedAgentHarnessAtom` mirroring the existing card-selector atom.
- [x] 8.4 Add the Agent dropdown as a sibling control at the same level as the project / worktree / branch selectors (NOT nested in or replacing the cards). Use the labels from the spec.
- [x] 8.5 Pass `agentHarness` through to the create-workspace mutation; use it as the first subChat's `harness`. The card value continues to drive `openspecChangeId` exactly as it does today.
- [x] 8.6 Component tests covering each axis is independent: (cards=spec-driven, agent=claude-cli) → subChat has `openspecChangeId` set + `harness='claude-cli'`; (cards=vibe-coding, agent=builtin) → subChat has `openspecChangeId IS NULL` + `harness='builtin'` (regression of today's behavior).

## 9. End-to-end verification

- [ ] 9.1 Manually verify each cell of the surface-router parameter table by creating one subChat per cell from the dock new menu and confirming the right surface mounts, the prompt input dispatches correctly, and (for editor cells) the sidebar shows the right surface.
- [ ] 9.2 Manually verify a CLI MCP tool call from inside an embedded `claude` session writes a plan file that the open plan sidebar picks up live without a manual refresh.
- [ ] 9.3 Manually verify alternate-screen TUI behavior: open `claude`, enter its TUI, exit cleanly, confirm prior scrollback is intact.
- [ ] 9.4 Manually verify mode-change → slash translation: change model in the input chip and send a prompt in a `claude-cli` chat; confirm the PTY received `/model <new>\n<prompt>\n`.
- [x] 9.5 Run `pnpm exec nx run desktop:test` and `pnpm exec nx run desktop:build` from repo root; both must pass.
- [x] 9.6 Update `apps/desktop/AGENTS.md` with: the surface-router rule, the `harness` column, the CLI harness bootstrap layer, the per-subchat MCP path, the dock new-menu registry, the resilience contract (D8–D11), the atomic-write helper, and the single-writer claim registry.

## 10. Session resilience and per-subChat isolation

- [x] 10.1 Audit `apps/desktop/src/renderer/features/agents/lib/sub-chat-store.ts` and document which state survives an app restart vs. which is reconstructed from DB. Codify the "in-flight stream state is dropped on restart" rule with a focused unit test.
- [x] 10.2 **Cold-restart-only for CLI subChats** (per design Q5 resolution, 2026-05-15). Do NOT probe TUI output for session ids; do NOT add a `harnessResumeKey` column; do NOT pass `--resume`/equivalent flags. The CLI bootstrap is always a fresh process. Update the reattach banner copy from §10.3 to read "Session ended on restart — Reattach (new CLI session; ask it to read the current plan to continue)" so the contract is explicit. Add a small note in `apps/desktop/AGENTS.md` (under the resilience section in 9.6) explaining the rationale (TUI output is unreliable; MCP plan/review files are the recovery vector).
- [x] 10.3 Implement lazy CLI respawn on panel activation after restart. Restored panels MUST mount in a disconnected state showing existing xterm scrollback (from the existing history-file path) plus a "Session ended on restart — Reattach" banner. The reattach handler invokes the same bootstrap path used at initial panel creation. Add a regression test: simulate restart with a `claude-cli` subChat and assert no PTY spawns until the panel is activated.
- [x] 10.4 Move CLI bootstrap config files to `<userData>/cli-bootstrap/<subChatId>.<harness>.<ext>` and make every spawn (initial, reattach, or hard-reset) fully overwrite the file with the current MCP `{port, bearer}` read fresh from `<userData>/churro-mcp.json`. Add an integration test that boots twice and asserts the file's bearer matches the second-session bearer after reattach.
- [x] 10.5 Harden MCP HTTP routing per `specs/session-resilience-and-isolation/spec.md`: 401 on bearer mismatch (no body details), structured JSON-RPC error on unknown `/sub/<id>/`, traces for both rejection paths. Add tests with undici/fetch hitting `/`, `/sub/<known>/`, `/sub/<unknown>/`, and with a bad bearer.
- [x] 10.6 Refactor `read_plan`, `read_review`, `write_review` so the path-scoped MCP factory closes over the subChatId and the tools never accept a `subChatId` argument from the path-scoped route. A buggy CLI passing `subChatId: 'B'` to a server bound to A must land in A's directory or be rejected — assert with a test.
- [x] 10.7 Implement `atomicWriteArtifact(path, body)` in `apps/desktop/src/main/lib/sub-chat-artifacts/atomic-write.ts` (new file). Contract: tmp-fsync-rename for the body, then tmp-fsync-rename for the meta. Route all plan/review writes through it. Grep guard test: assert no direct `fs.writeFile` under `<userData>/sub-chats/` outside the helper.
- [x] 10.8 Implement orphan-`.tmp` sweep at app boot (after migrations) under `<userData>/sub-chats/*/{plans,reviews}/`. Log `[artifact-sweep] removed orphan <path>` per file. Unit test that seeds an orphan and asserts it is gone after boot.
- [x] 10.9 Implement the in-memory single-writer claim registry in the main process keyed by subChatId. Expose `chat:claimOwnership({ subChatId, paneId, windowId })`, `chat:releaseOwnership`, `chat:takeOverOwnership`, and a tRPC subscription `chat:ownership` that pushes ownership changes. Release on panel close, window close, and app exit.
- [x] 10.10 Wire the claim into the renderer: non-owner panels render a "Already open in another window — actions are read-only here" banner with a "Take over here" CTA; Send button, sidebar action buttons, and CLI bootstrap are disabled in non-owner state. Reads remain available. Component test covers both panels in two test stores.
- [x] 10.11 Add the "Hard-reset session" action in the chat-panel header (menu item + icon). Implementation per harness exactly as `specs/session-resilience-and-isolation/spec.md` describes. The action MUST work even when the agent stream/PTY/MCP is unresponsive (do not gate the action on a healthy stream). For CLI variants, show a confirm dialog with a "Clear scrollback too" checkbox (default off).
- [x] 10.12 Implement stuck-session detection: PTY exit code ≠ 0 in <5s, PTY silence >60s while streaming, three consecutive MCP 5xxs, built-in stream silence >120s during tool call. When any heuristic is active, show a **stall icon** in the chat-panel header (distinct `data-testid` from the harness icon in 2.5). Clicking the stall icon expands the advisory banner with the heuristic-specific copy and a Hard-reset CTA. Banner is dismissable but the stall icon stays visible until the underlying heuristic clears. No auto-reset, no auto-respawn, ever — the user always decides. Thresholds are fixed in code (no settings knob). Add traces `[stuck-detect] subChat=<id> reason=<kind>` for telemetry only.
- [x] 10.13 Add an integration test that runs the full restart-resumption flow end-to-end: create a builtin subChat with messages + a CLI subChat with scrollback, simulate restart, verify builtin restores message history, CLI restores scrollback + shows the disconnected banner, activate the CLI tab and verify a new PTY spawns with the current bearer.
- [x] 10.14 Add a focused test that two test stores opening the same subChatId yield one owner and one read-only panel, and that take-over swaps them cleanly.
- [x] 10.15 Telemetry: a single trace `[resilience] subChat=<id> event=<restart|reattach|hard-reset|claim|takeover|stuck>` covers every observable resilience transition. No payload, no bearer, no prompt body.

## 11. High-ROI test battery

Cross-cutting tests that catch the silent-regression classes most likely to bite during future refactors. Each task names the *failure mode it catches* so it survives "while I'm here" cleanup. These supplement (and do not replace) the per-section tests above; where a per-section task already covers a slice, that's noted in the body.

### Routing and rendering

- [x] 11.1 **Router parameter-table test** (supersedes 2.6 as the single source of truth). Table-driven test over the 6 cells in `specs/chat-surface-router/spec.md`. For each `(harness, openspecChangeId)`: render `ChatPanel` with a seeded subChat row, assert the right content component mounts (`AgentsContent` / `OpenSpecChangeView` / `ChatCliSurface`) by querying for a stable `data-testid` per surface, and assert the sidebar slot (in editor cells) renders the right inner surface. **Catches**: a future contributor adds a 4th harness or a new `openspecChangeId` branch and forgets a cell.
- [x] 11.2 **Input dispatcher matrix**. Table-driven test for `useHarnessSendDispatcher` covering 3 harnesses × 2 dispatch shapes (prompt-only, prompt + mode-change). For each row, assert exactly one tRPC mutation fires with the expected payload (`chat.send` for builtin; `terminal.write` with the composed `\n`-suffixed body for CLI). **Catches**: silent regression where a refactor sends to both paths or none.
- [x] 11.3 **Sidebar action button dispatcher matrix**. Table-driven test for Approve plan, Build plan, Fix review issues × 3 harnesses (9 cells). Assert each action routes through the same dispatcher as 11.2 and the CLI rows produce the expected free-text instruction (per design Q2 recommendation). **Catches**: an action button bypassing the dispatcher and calling `chat.send` directly even when harness is a CLI.
- [x] 11.4 **Slash-command translation adapter** (supersedes 3.4 for completeness). Per-harness adapter table: `(currentMode, requestedMode, currentModel, requestedModel) → composedPrefix`. Include the "no translation needed" fall-through case and assert it produces an empty prefix plus a single `[harness-adapter] no-op` trace. **Catches**: adapter coupling to undocumented CLI internals; missing trace when translation is skipped.
- [x] 11.5 **Per-harness icon rendering** (dockview tab + in-panel header + dock new-menu + wizard dropdown). For each harness, render the four surfaces and assert the expected `data-testid` (`harness-icon-builtin` / `harness-icon-claude-cli` / `harness-icon-codex-cli`) is present in each location. Assert no Claude/Codex icon ever appears on a `builtin` panel (regression guard). Assert the icon-registry mapping is one-to-one (no duplicate icons across harness keys). **Catches**: (a) a future contributor renaming a harness key without updating the icon map; (b) drift between tab and header (e.g. tab updated but header not).
- [x] 11.17 **Stall icon visibility and independence from harness icon**. For each stuck-session heuristic (4 cases × 3 harnesses where applicable = up to 12 cells, skip nonsensical ones), force the heuristic to fire and assert: (a) the stall icon is visible with its stable `data-testid`; (b) the harness icon is still visible alongside; (c) banner dismiss hides the banner but the stall icon stays. **Catches**: a future styling change that overlaps or hides one icon behind the other.

### Wizard combinations

- [x] 11.6 **Wizard 2 × 3 combination matrix** (extends 8.6 from 2 cells to all 6). Table-driven test over `(card ∈ {vibe-coding, spec-driven}) × (agent ∈ {builtin, claude-cli, codex-cli})`. For each cell, drive the wizard, click Submit, and assert the resulting first subChat row has the exact `(harness, openspecChangeId IS NULL?)` shape predicted by the cell. **Catches**: someone making the axes accidentally interdependent (e.g., disabling `spec-driven` when agent is a CLI).

### Isolation invariants (silent-failure class)

- [x] 11.7 **Schema invariants** (consolidates 1.5 + 1.6 + backfill). One test file that asserts: (a) CHECK constraint rejects `'gemini-cli'` and `''`; (b) Zod enum on `chat.createSubChat` rejects the same; (c) UPDATE of `harness` on an existing row is rejected at the tRPC layer (per 1.5); (d) migrating a DB with rows that lack the column yields all-rows `harness='builtin'`. **Catches**: each of these is a one-line regression that a future schema PR could introduce silently.
- [x] 11.8 **MCP subChatId-override attack test**. Drive a JSON-RPC `write_review` request to `/sub/A/` with the bearer, where the tool args include `subChatId: 'B'` (and any other shape a buggy CLI might invent). Assert: (a) the write lands at `<userData>/sub-chats/A/reviews/current.md`, never at `B/`; (b) `B/`'s directory is byte-identical before and after; (c) the path-scoped tool's argument schema does not declare a `subChatId` field at all (introspect via MCP `tools/list`). **Catches**: a future tool definition copy-paste exposing `subChatId` as an arg on the path-scoped factory.
- [x] 11.9 **Cross-subChat MCP scope leak**. Two simultaneous JSON-RPC sessions: session 1 holds an open MCP transport to `/sub/A/`; session 2 opens `/sub/B/`. Both fire `read_plan` concurrently. Assert each session receives only its own plan body, neither closure captures the other's id, and the server constructs distinct `McpServer` instances per route. **Catches**: a future refactor that hoists `createMcpServerForSubChat` to a memoized singleton.

### Resilience invariants (data-loss class)

- [x] 11.10 **Atomic-write crash recovery** (extends 10.7). Three sub-cases driven by deterministic stubs: (a) crash between `.tmp` write and rename — assert old `current.md` body still intact, no `.tmp` orphan on next read (sweep ran); (b) crash between body rename and meta rename — assert body is new, meta is old, reader still parses; (c) successful write end-to-end — assert body and meta both reflect new revision. **Catches**: a future "simpler" write path that skips fsync or interleaves meta before body.
- [x] 11.11 **Single-writer claim race**. Two tRPC clients call `chat.claimOwnership` for the same subChatId within the same tick. Assert exactly one client receives `granted: true`; the other receives `granted: false, currentOwner: {windowId, paneId}`. Then call `takeOverOwnership` from the second client and assert ownership flips and the first client receives a subscription event reflecting the new state. **Catches**: a future async-aware refactor that turns the registry into a race-prone read-then-write.
- [x] 11.12 **Hard-reset under unresponsive conditions** (extends 10.11). Three sub-cases: (a) builtin chat with a stuck stream — assert Hard-reset still completes within 2 s, the abort path was invoked, and message history is intact; (b) CLI chat with a frozen PTY that ignores SIGTERM — assert SIGKILL escalation fires after 2 s, the per-CLI config file is rewritten, and a new PTY spawns; (c) CLI chat while MCP returns 5xx — assert Hard-reset does not depend on MCP availability. **Catches**: any future code path that gates Hard-reset on a healthy stream/PTY/MCP, which would defeat the whole point of the button.
- [x] 11.13 **Restart resumption split** (replaces 10.13 with three smaller tests for easier triage). (a) `builtin`-only: simulate restart, assert message history fully restored and `status='idle'`; (b) `claude-cli` scrollback restore: simulate restart, assert xterm shows prior scrollback, no PTY spawned, banner visible; (c) lazy respawn: activate the CLI panel after restart, assert exactly one PTY spawn with the *current* bearer (not the prior session's). **Catches**: regressions where one of the three flows breaks silently because the other two still pass.
- [x] 11.14 **Stuck-session detection — no-auto-reset guarantee** (extends 10.12). Force all four heuristics to fire simultaneously for one subChatId; assert no Hard-reset runs, all four banner messages render, and dismissing one does not re-fire on the same triggering event. **Catches**: a "helpful" future change that auto-resets on stuck-detection, which would destroy long-running legitimate operations.

### Test-suite hygiene

- [x] 11.15 **Coverage assertion for the parameter table**. Add a tiny meta-test that imports the surface-router enum + the dispatcher enum and fails the test run if any cell from `specs/chat-surface-router/spec.md`'s table is missing a 11.1 / 11.2 case. **Catches**: a new harness landing without table-row coverage.
- [x] 11.16 Run `pnpm exec nx run desktop:test` after each section above to confirm no Vitest test is flaky under the jsdom + isolated-store conventions in `apps/desktop/AGENTS.md`. Any flakiness must be fixed (not retried) before merge.

## 12. Harness durability through dockview re-mounts

Bug observed during manual verification: dragging a `claude-cli` or `codex-cli` panel within dockview re-mounts it as the classic builtin `AgentsContent` surface. Root cause: the panel-entity type that backs dockview `params` lacks a `harness` field, so the re-mount has no way to carry the discriminator through dockview, and `chat-panel.tsx` falls back to the eventual-consistency store/query path — which for freshly-created CLI subChats can be stale, yielding the `'builtin'` default.

- [x] 12.1 Add `harness?: 'builtin' | 'claude-cli' | 'codex-cli'` to the `ChatPanelEntity` type in `apps/desktop/src/renderer/features/dock/atoms.ts` so dockview `params` carry the discriminator across drag-and-drop, tear-out, and layout deserialization.
- [x] 12.2 Populate `harness` at every panel-entity construction site: `apps/desktop/src/renderer/features/dock/use-panel-actions.ts` (`newSubChat` and `newSubChatWithHarness` — both the optimistic `addPanel` call and the `addOrFocus` data payload), `apps/desktop/src/renderer/features/dock/chat-panel-sync.tsx` (`panelEntityForSubChat` and the hydration loop), plus any other `addOrFocus({ kind: 'chat', ... })` caller a repo-wide grep surfaces.
- [x] 12.3 In `apps/desktop/src/renderer/features/dock/panels/chat-panel.tsx`, prefer `params.harness` over the store/query-derived fallback when both are present. The `?? 'builtin'` default MUST only fire when no source has produced a value (truly unknown subChat). Add a one-line `[chat-panel] subChat=<id> harness=<value> source=params|store|fallback` trace at mount so the resolution path is auditable.
- [x] 12.4 Audit `useAgentSubChatStore` (`apps/desktop/src/renderer/features/agents/stores/sub-chat-store.ts`) to confirm `addToAllSubChats` and `setAllSubChats` persist the harness for **every** value (including `'builtin'`). Update the localStorage harness-map writer if it currently skips defaults so a later re-mount via the store-fallback path still resolves correctly.
- [x] 12.5 Regression test colocated as `apps/desktop/src/renderer/features/dock/panels/chat-panel-dock-remount.component.test.tsx`. Drive the test through `renderWithProviders`: mount `ChatPanel` for a seeded `claude-cli` subChat row, unmount, and re-mount with the same `params` (no harness in the store this time). Assert (a) `ChatCliSurface` is the only chat-content surface that appears in the DOM, (b) `AgentsContent` never appears (use a `data-testid` query for both), and (c) the harness icon in the header has `data-testid="harness-icon-claude-cli"`. Mirror the test for `codex-cli`. **Catches**: a future contributor dropping `harness` from `ChatPanelEntity` or from a construction site.
- [ ] 12.6 Manual verification per `specs/chat-surface-router/spec.md` "Harness persists through dockview panel re-mounts": (a) drag a `claude-cli` panel across groups in the same window; (b) tear out a `codex-cli` panel into a new window; (c) restart the app with a layout containing both CLI panels. In every case, no builtin flash, the CLI surface mounts first try, and the tab/header icons stay correct.

## 13. CLI harness MCP trust improvements

- [x] 13.1 Add `--allowedTools mcp__churro-coder-<subChatId>__write_plan,mcp__churro-coder-<subChatId>__write_review` to the `claude-cli` bootstrap args in `apps/desktop/src/main/lib/cli-harness/index.ts` so Claude Code never prompts for MCP tool permission on `write_plan` / `write_review`.
- [x] 13.2 Tighten the `--append-system-prompt` for `claude-cli`: replace verbose RULE 1/RULE 2 prose with proven terse imperative wording validated in manual testing: "call write_plan mcp tool with a copy of any plan you write before approval so I can read it. Call write_review mcp tool with a copy of any code review you write before finishing your response."
- [x] 13.3 On `initMcpHttpServer` startup, sweep all `churro-coder-*` keys from `~/.claude.json` before starting the server. Fixes "failed" MCP entries in Claude's `/mcp` view after app restart — stale entries from prior sessions point to a dead port and Claude marks them failed. The sweep runs once at startup (guarded by `state` check) and errors are non-fatal (logged as warn).
- [x] 13.4 Add `-a never` to codex-cli bootstrap args. Codex has no tool-specific allow-list (unlike Claude's `--allowedTools`), so the global approval gate must be disabled for `write_plan`/`write_review` to run without prompting. The user has already consented by opening the embedded session.

## 14. CLI mode bootstrap improvements

- [x] 14.1 Reduce idle detection silence threshold from 5 s to 1 s in `apps/desktop/src/main/lib/cli-harness/index.ts` (`idleDetection.silenceMs`). The advisory busy state on the Send button should clear within 1 s of the CLI going quiet, not 5 s.
- [x] 14.2 In `buildCliBootstrap` (`apps/desktop/src/main/lib/trpc/routers/chats.ts`), after calling `buildBootstrap`, read the first user message from the `messages` table and the subChat's `mode` from the DB. Inject as `result.initialInput` so the CLI starts with the user's task pre-filled. For `claude-cli` + `mode === 'plan'`, prepend `/plan\r` so the CLI switches to plan mode before executing the prompt. For `codex-cli` or any non-plan mode, send only the message text. Errors parsing message parts are non-fatal; if no text part is found, `initialInput` is left unset.
- [x] 14.3 Fix PTY `initialInput` submission: `session.ts` was normalising the trailing character to `\n` (LF) but PTYs in raw mode require `\r` (CR) to submit a line — `\n` only moves the cursor down without executing. Replace the normalisation in `session.ts` to convert all `\n` to `\r` and ensure a trailing `\r`. Also fix the `/plan` separator in `chats.ts` from `\n` to `\r` for the same reason.
- [x] 14.4 In plan mode, prepend `"IMPORTANT: call write_plan before ExitPlanMode; call write_review before your final review message.\r"` to the user prompt text in `buildCliBootstrap`. Applies to both `claude-cli` and `codex-cli` whenever `mode === 'plan'`. For `claude-cli` the full sequence is `/plan\r` → instruction → user text; for `codex-cli` it is instruction → user text.

## 15. CLI prompt bar: slash command autocomplete and image thumbnails

- [x] 15.1 Add `/command` autocomplete dropdown to `CliPromptBar` using `AgentsSlashCommand`. Detect when the input matches `^/\w*$` and show the dropdown. Mode-change commands (`/plan`, `/execute`, `/explore`, `/compact`) dispatch immediately via the harness dispatcher and clear the input; other commands insert as text for the user to complete and send.
- [x] 15.2 Add pasted image thumbnail chips to `CliPromptBar`. Replace the current `setText(@path)` insertion with visual chips (small `<img>` + X dismiss button) above the textarea. On send, prepend all `@path` refs (space-joined, newline before user text) before dispatching. Keep `@path` text insertion for large-text pastes unchanged.
- [x] 15.3 Write Vitest tests for the updated `CliPromptBar` (colocated as `cli-prompt-bar.test.tsx`): (a) typing `/p` opens the slash dropdown, (b) selecting `/plan` calls the dispatch mock and clears input, (c) pasting an image renders a thumbnail chip, (d) removing the chip removes the image from state.
