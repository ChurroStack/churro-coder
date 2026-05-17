<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

> **Read the root [`AGENTS.md`](../../AGENTS.md) first.** It carries monorepo-wide rules (Core Invariants, Worktree Discipline, Nx/pnpm/bun conventions, cross-app build & test commands, drizzle migration gotchas) that apply here too. The rest of this file is desktop-specific addenda — not a replacement.
>
> Claude Code auto-loads both files when launched anywhere inside the repo (it walks up the directory tree). The pointer above is for tools that follow strict "closest-wins" semantics (Codex, Cursor, etc.), and as a reminder after `/compact`.

# AGENTS.md (apps/desktop)

This file is the canonical agent guide for the Electron desktop app. `CLAUDE.md` next to it is a symlink — edit this file, not the symlink. The `OPENSPEC:START`/`OPENSPEC:END` block above is managed by `openspec update`; leave it intact.

This is the **slim hub**. It carries the always-needed context (what the app is, how to run it, where files live) and points to detail docs under [`docs/`](docs/) for deep dives. Open the spoke that matches your task — don't read all of them up front.

## Deep-dive index

| Topic | When to open |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full `src/` tree, key patterns (IPC / state / Claude / dockview), tech stack, Tailwind v3 note, file-by-file pointers |
| [docs/database.md](docs/database.md) | Drizzle schema, auto-migration, query examples |
| [docs/release.md](docs/release.md) | Notarization, package commands, version bump, auto-update |
| [docs/multi-provider.md](docs/multi-provider.md) | Claude ↔ Codex interleaved chat, catch-up mechanism, Codex cost computation |
| [docs/workflow-state.md](docs/workflow-state.md) | Plan→Code→Review→PR state machine, `pendingXxxMessageAtom` pattern, invariants |
| [docs/chat-orchestrator.md](docs/chat-orchestrator.md) | Layered architecture (machines/services/components/hooks), refactor playbook for `active-chat.tsx`, bug-cluster regression matrix, Phase 3 wiring contract |
| [docs/testing.md](docs/testing.md) | 6-layer test battery, when to add a test, conventions, `test-utils/` helpers |
| [docs/prompts.md](docs/prompts.md) | **Read before adding any LLM-bound prompt.** Invariant: every agent prompt is a `.j2` template under `src/prompts/` — never an inline string. Covers layout, how to add one, user overrides via `.cscode/worktree.json`, and gotchas |
| [docs/debug.md](docs/debug.md) | Electron debugging stack: opt-in CDP port, repo-registered Playwright MCP for cross-provider UI driving, Playwright Electron for repeatable specs, renderer/main log forwarding, structured debug server |
| [docs/postmortems/](docs/postmortems/) | Incident writeups with triage heuristics for recurring bug classes |
| [docs/status.md](docs/status.md) | Current branch's recent work + known limitations / deferred items |
| [DESIGN.md](DESIGN.md) | **Read before building any new UI.** Design system: color tokens, typography, layout, elevation, shapes, component primitives, do's and don'ts |

## What is this?

**Churro Coder** - A local-first, fully offline Electron desktop app for AI-powered code assistance. Users create chat sessions linked to local project folders, interact with Claude in Plan or Agent mode, and see real-time tool execution (bash, file edits, web search, etc.). All functionality runs on-device — no login, no cloud sync, anonymized crash reports sent via Sentry by default (opt out in Settings -> Privacy); traces and logs are off in prod unless the user flips the session-scoped "Share full debug logs this session" toggle for a bug repro.

## Commands

This app is bun-managed; do not run `pnpm install` here. From the monorepo root the same flows are also available via Nx (`pnpm exec nx run desktop:dev` / `:build` / `:dist` / `:package`), which shells back into these scripts.

**Typechecking:** `bun run ts:check` (or `bun run typecheck`) runs `tsc --noEmit`. The project has pre-existing errors from third-party SDK incompatibilities and drizzle/tRPC narrowing that are unrelated to any given change, so treat new errors as signal but ignore the pre-existing noise. Prefer `bun run build` for a full correctness check, or run the app with `bun run dev` and exercise the affected feature.

```bash
# Development
bun run dev              # Start Electron with hot reload (electron-vite)
bun run dev:debug        # Same as dev, plus Chromium remote debugging on :9222 (for the agent debug loop — see docs/debug.md)

# Build / package
bun run build            # electron-vite build → out/{main,preload,renderer}
bun run package          # electron-builder --dir (no installer)
bun run package:mac      # Build macOS (DMG + ZIP)
bun run package:win      # Build Windows (NSIS + portable)
bun run package:linux    # Build Linux (AppImage + DEB)
bun run dist             # Full electron-builder release
bun run dist:manifest    # Generate update-manifest JSON for the CDN
bun run dist:upload      # Upload release artifacts (used by release pipeline)
bun run release          # Full pipeline: clean → install → fetch CLIs → build → package:mac → manifest → upload
bun run release:dev      # Local release rehearsal (no upload)

# Bundled CLI binaries (downloaded into resources/bin)
bun run claude:download       # Fetch Claude Code CLI for current arch
bun run claude:download:all   # Fetch for all arches
bun run codex:download        # Fetch Codex CLI for current arch
bun run codex:download:all    # Fetch for all arches

# OpenSpec CLI (auto-installed by postinstall; run manually to reinstall or upgrade)
bun run openspec:install        # Install pinned version into resources/openspec/pkg/
bun run openspec:install:latest # Install latest version from npm

# Database (Drizzle + SQLite)
bun run db:generate      # Generate migrations from schema
bun run db:push          # Push schema directly (dev only)
bun run db:studio        # Open Drizzle Studio against the local DB

# Misc
bun run icon:generate    # Regenerate platform icon set from build/icon source
```

## Top-level layout

```
src/
├── main/         # Electron main process (auth, db, tRPC routers)
├── preload/      # IPC bridge (context isolation)
└── renderer/     # React 19 UI (features/, components/, lib/)
```

For the full annotated tree (renderer features, dock subsystem, agent layers), see [docs/architecture.md](docs/architecture.md).

## File Naming

- Files: kebab-case for components, hooks, stores, and utilities (`active-chat.tsx`, `agents-sidebar.tsx`, `use-overflow-detection.ts`, `agent-chat-store.ts`)
- Atoms: camelCase with `Atom` suffix (`spotlightOpenAtom`, `terminalSidebarOpenAtom`)

## Shared UI Decisions

> Authoritative design tokens, typography, layout primitives, and component conventions live in [DESIGN.md](DESIGN.md). Read it before building any new UI. The screen-specific notes below are addenda, not replacements.

- New-workspace content should use the same readable width as the main chat surface (`max-w-5xl`), not a narrower one-off container.
- OpenSpec document content (proposal, design, tasks views) must also use `max-w-5xl mx-auto` — do not use narrower fixed widths like `max-w-[720px]`.
- For selection cards and similar form surfaces on this screen, prefer the tighter shared radius (`rounded-md`) over oversized `rounded-2xl` / `rounded-3xl` shells unless a component already has a stronger established visual treatment elsewhere.
- The agent mode chooser is a segmented control with a detail panel below it, not a grid of large cards. Keep the selected icon, title, and description in the dedicated panel.
- For the `Type of work` and `Harness` cards, keep the icon and title on the same top row, with the description underneath.
- Keep the new-workspace hero compact. If spacing changes are needed, adjust the wrapper's top padding first instead of adding extra margin above the hero or compressing the inner sections unevenly.
- **`NewProjectDialog` is the single entry point for adding projects.** The old `SelectRepoPage` and "Add repository" / "Add from GitHub" buttons have been removed. Any UI surface that wants to add a project should open `newProjectDialogOpenAtom` (from `src/renderer/features/new-project/atoms.ts`). The dialog handles three flows: Create (GitHub / Azure DevOps / Local, with CLI detection, auth check, scaffolding, and initial commit), Open (wraps `projects.openFolder`), and Clone (GitHub + Azure DevOps URLs, backed by `cloneIntoRepos`).

## Chat surface router

Each subChat has an immutable `harness` column (`'builtin' | 'claude-cli' | 'codex-cli'`) written once at creation and never updated. The chat panel routes to the correct surface using `(harness, openspecChangeId)`:

| harness | openspecChangeId | main area | sidebar slot |
|---|---|---|---|
| `builtin` | null | `AgentsContent` | classic messages |
| `builtin` | set | `OpenSpecChangeView` | classic messages |
| `claude-cli` | null | `ChatCliSurface` | — |
| `codex-cli` | null | `ChatCliSurface` | — |
| `claude-cli` | set | `OpenSpecChangeView` | `ChatCliSurface` |
| `codex-cli` | set | `OpenSpecChangeView` | `ChatCliSurface` |

**Immutability rule:** The `harness` column MUST NOT appear in any UPDATE SET clause. Any tRPC mutation that attempts to set `harness` on an existing row is rejected with a `[harness-immutable]` trace and an error naming the rule.

**Harness icon registry:** `src/renderer/features/agents/lib/harness-icons.ts` — single source for icons, labels, and test IDs (`data-testid="harness-icon-builtin"` / `harness-icon-claude-cli` / `harness-icon-codex-cli`). The dock new-menu, wizard agent dropdown, chat tab, and chat header all read from this registry.

**Send dispatcher:** `useHarnessSendDispatcher(subChatId)` in `src/renderer/features/agents/hooks/use-harness-send-dispatcher.ts`. For `builtin`, calls the existing agent-send path. For CLI harnesses, translates slash commands and writes to the terminal PTY via `terminal:write`. All sidebar action buttons (Approve plan, Build plan, Fix review issues) also go through this dispatcher.

**Advisory busy state:** After dispatching to a CLI PTY, the Send button dims (`opacity-40`) until the `terminal:idle` event fires. Force-send still works — this is a visual hint only (`data-advisory` attribute, never a hard `disabled`).

## CLI harness bootstrap layer

`src/main/lib/cli-harness/index.ts` — called by `chats.buildCliBootstrap` tRPC procedure.

**Binary discovery:** bundled binary under `resources/bin/<platform>-<arch>/` first; falls back to PATH lookup + version probe. Results cached per session in an in-memory `Map`. Invalidate with `invalidateBinaryCache()`.

**MCP injection:**
- `claude-cli`: merges `churro-coder-<subChatId>` entry into `~/.claude.json` atomically (via the existing `Mutex`).
- `codex-cli`: passes `-c mcp_servers.churro-coder-<subChatId>.url="<url>"` and `-c mcp_servers.churro-coder-<subChatId>.bearer_token_env_var="CHURRO_MCP_BEARER"` in args; bearer is set as `CHURRO_MCP_BEARER` in the PTY env.

**Env injection:** `CHURRO_SUBCHAT_ID=<subChatId>` for both harnesses. `CHURRO_MCP_BEARER=<bearer>` additionally for `codex-cli`.

**Error shape:** `{ kind: 'binary-missing' | 'mcp-unavailable' | 'config-write-failed', ... }` — `ChatCliSurface` renders this with a Retry action. Use `isBootstrapError(result)` to discriminate.

**Traces:** `[harness-bootstrap]` prefix. Logs bootstrap start, success (binary path + pid), and failure (reason). No bearer, no prompt body.

**PTY pane id:** `cli:<subChatId>` — stable, one-to-one with the subChat. All terminal subscriptions use this id.

## Per-subChat MCP routing

The MCP HTTP server routes `/sub/<subChatId>/...` to a per-subChat `McpServer` instance (`createMcpServerForSubChat`). The root route `/...` remains the global server. Both routes validate the bearer on every request (401 on mismatch, no body). Requests to `/sub/<unknown-id>/` return a structured JSON-RPC error with a `[mcp-routing]` trace.

The path-scoped tools (`read_plan`, `read_review`, `write_review`) close over the subChatId at factory time and never accept a `subChatId` argument from the client — a buggy CLI passing `subChatId: 'B'` to a server bound to `A` always writes to `A`'s directory.

`initMcpHttpServer` coalesces concurrent callers via an `initInFlight` promise and also returns `restartInFlight` if a crash-restart is in progress. This is load-bearing: two CLI subChats bootstrapping in parallel must share the same MCP HTTP server lifetime, otherwise each gets its own server, the `state` singleton is overwritten by whichever assignment lands last, the loser's `~/.claude.json` entry can be wiped by the second sweep, and the loser's Claude CLI hangs on an MCP handshake (presenting as a blank PTY). The startup sweep itself is intentional — new server lifetime = fresh port, so every prior `churro-coder-*` URL is dead and each live CLI re-bootstraps to re-inject — but it MUST run exactly once per lifetime before any subChat's inject.

## Per-subChat isolation invariant

The project hierarchy is **project → worktree → subChat**. Two subChats in the same worktree (two Claude CLIs, two Codex CLIs, a builtin chat + a CLI, etc.) must run fully in parallel without cross-talk. All in-process state whose lifecycle is tied to a single subChat MUST be keyed by `subChatId`:

- **Renderer atoms:** use `atomFamily(subChatId)`. Never a global atom carrying `subChatId` in its payload — every mounted consumer rerenders when the atom changes, the `wrong-sub-chat` guards become required, and a second writer can clobber the first writer's value before the first writer's effect drains it. The historical bug class was the `pending*MessageAtom` family (PR #51, plus the round of fixes that introduced this invariant).
- **Main-process maps/sets:** `Map<subChatId, …>` with explicit cleanup on subChat deletion, panel unmount, or `terminal:exit`. Module-level Sets keyed by subChatId are fine *only* if every code path that ends the subChat's lifetime also calls the corresponding `forget*(subChatId)` — see `mcpInjectedSessions` in `use-harness-send-dispatcher.ts`.
- **PTY pane ids:** `cli:<subChatId>` only. Never `cli:<cwd>` or `cli:<workspaceId>` — two subChats can share a worktree.
- **MCP routing:** `/sub/<subChatId>/...` on the HTTP transport; per-subChat servers close over the `subChatId` at factory time and never accept it from the client.
- **xterm instances:** one `Terminal` component per paneId; xterm/fitAddon/serializeAddon refs live in `useRef` inside `terminal.tsx` and are never shared across mounts. A future refactor that reuses a single xterm canvas across panels would reintroduce the cross-talk class — push back on it in review.

Worktree-keyed state (e.g. `git-cache.ts`, the workflow snapshot query) is permitted only when the value is intrinsically a property of the worktree, not of a specific subChat. Global singletons (the MCP HTTP server, the CLI binary cache) are permitted only for app-level resources and MUST guard their lifecycle transitions (init / restart / close) with a mutex or in-flight promise.

**Reviewer heuristic:** any new atom whose value type contains `subChatId` is a smell — push back unless there is a concrete cross-window broadcast reason. Any new `Map<string, …>` in the main process that takes a subChatId-shaped key needs a documented cleanup path.

## Per-window isolation

`apps/desktop/src/main/index.ts` supports multiple `BrowserWindow`s. Each window is a separate renderer process with its own jotai store, so per-window atom state (drafts, transient UI flags, pending* family atoms) is naturally isolated. Main-process state aggregated across windows is intentional in two places:

- `terminalManager` methods like `killByWorkspaceId`, `getSessionCountByWorkspaceId`, `refreshPromptsForWorkspace` walk all PTYs and filter by `workspaceId`. The `workspaceId` is window-derived (one workspace per chat/window) — colliding it between two windows would mass-kill PTYs across both, so never derive it from anything user-controllable (cwd, project name).
- `ownership-registry` keys by `subChatId` with a single-owner model. When two windows open the same subChat, only one drives at a time; takeover transfers ownership and notifies the loser via an event whose payload includes `subChatId`.

Per-subChat draft text (`drafts.ts`) and per-subChat trigger atoms (the `pending*AtomFamily` set) are **per-window by design** — same subChat in two windows has two independent draft buffers. Per-subChat shared state (messages, plan, review) lives in SQLite and is shared via tRPC / per-subChat MCP routes.

## Query cache contract

The renderer's `QueryClient` (`src/renderer/contexts/TRPCProvider.tsx`) is constructed inside `useState(() => new QueryClient(...))` on every cold start — it is never persisted to disk via `persistQueryClient`. Cold-start state is always empty. Within a session, `staleTime: 5_000` (`gcTime: 60_000`) keeps panel re-mounts cheap, but server-side data that changes via PTY output / MCP writes must be invalidated explicitly from the mutation's `onSuccess` (existing pattern) or from the per-subChat event subscription. Do NOT introduce `persistQueryClient` — it would defeat the cold-start guarantee that anchors the isolation contract.

## CLI session resilience contract

**Cold-restart-only:** CLI subChats always start a fresh PTY on restart. There is no session-resume (`--resume` flag or similar). Do NOT probe TUI output for session ids; do NOT add a `harnessResumeKey` column.

**Rationale:** TUI output (especially alt-screen) is unreliable as a carrier for session IDs. MCP plan/review files written to `<userData>/sub-chats/<id>/` are the recovery vector — the CLI can read its last plan and continue from there.

**Reattach banner copy:** "Session ended on restart — Reattach (new CLI session; ask it to read the current plan to continue)"

**Lazy respawn:** Restored CLI panels mount in a disconnected state (xterm scrollback + banner). The reattach handler invokes the same bootstrap path used at initial panel creation. No PTY spawns until the panel is activated.

**Config overwrite on respawn:** Every spawn (initial, reattach, or hard-reset) fully overwrites the MCP config file at `<userData>/cli-bootstrap/<subChatId>.<harness>.<ext>` with the current port + bearer read fresh from `<userData>/churro-mcp.json`. This ensures the CLI always talks to the live MCP server, not a stale one from a prior session.

## Dock new-menu registry

`src/renderer/features/dock/new-menu-registry.ts` — 5 entries: `chat`, `chat-claude-cli`, `chat-codex-cli`, `terminal`, `openspec-change`. Each entry has `defaultPinned`. The `dockNewMenuPinnedAtom` persists the user's pinned selection under `dock.newMenu.pinned`. The toolbar component (`dock-new-menu-toolbar.tsx`) renders pinned entries as icon buttons and non-pinned entries in an overflow dropdown.

## Gotchas

### Codex CLI: no per-tool allow-list

Codex CLI has no equivalent of Claude Code's `--allowedTools` flag, so `buildBootstrap` passes `-a never` to disable Codex's global approval gate. This means **every Codex tool call (including shell commands) runs without an interactive prompt**. The user has implicitly consented by launching an embedded CLI session inside Churro Coder, but anyone touching `cli-harness/index.ts` should understand that `-a never` is a load-bearing decision — removing it will block every Codex tool call on an interactive approval the UI can't surface, and replacing it with a narrower setting (`-a on-request`, etc.) needs a redesign of how the embedded TUI handles prompts.

`buildBootstrap` also passes `-s workspace-write` alongside `-a never`. These two flags work as a pair:

- `-a never` alone is not enough — without an explicit sandbox tier, Codex defaults to `read-only`, and any write or exec attempt triggers a sandbox-escalation flow that in the embedded TUI manifests as the very approval prompts `-a never` is meant to skip.
- `workspace-write` allows reads anywhere, writes inside the workspace cwd and `$TMPDIR`, and keeps network blocked by default. It is the standard Codex "sandboxed-but-functional" tier and does **not** disable the OS sandbox.
- Do not replace `-s workspace-write` with `danger-full-access` — that disables the sandbox entirely. Do not use `--full-auto` either — it is shorthand for `-a on-failure -s workspace-write`, and `on-failure` would reintroduce prompts on failed commands.

`buildBootstrap` also sets `default_tools_approval_mode="approve"` on the injected MCP server. **This is necessary because `-a never` only suppresses shell-command approval prompts — MCP tool-call approval is a separate gate controlled by a per-server config field.** Without it, every `write_plan`, `write_review`, etc. call shows an interactive approval prompt in the embedded TUI. The field is set only on the per-subChat server (not globally), so it has no effect on any other MCP server the user may have configured.

The Claude path uses `--allowedTools` to pre-authorize just the MCP write tools (`write_plan`, `write_review`, `write_tasks`, `update_task_status`); everything else still goes through Claude's normal approval flow.

### Sandbox writable-path changes must be verified across all providers

The agent sandbox (which paths the OS allows writes to) is configured separately per provider:

- **Claude** — `src/main/lib/trpc/routers/claude.ts` calls `resolveSandboxPolicy(...)` then `writeSandboxSettingsFile(cwd, sandboxPolicy)`. Writable roots come from `sandboxPolicy.writableRootsExpanded`.
- **Codex** — `src/main/lib/trpc/routers/codex.ts` calls `resolveSandboxPolicy(...)`, then passes `writableRootsExpanded` through `resolveOpenSpecCodexToolConfig` → `buildCodexTurnConfig` → `buildCodexWorkspaceWriteSandboxPolicy` or `buildCodexSandboxPolicy`. The `forceWritableRoots` path bypasses the mode check entirely.

Both ultimately derive their writable root set from `buildWritableRoots` in `src/main/lib/sandbox/policy.ts`, which is the single source of truth. **Any change to that function, or to how either router filters/augments its output, must be cross-checked against the other router** — a fix applied only to `codex.ts` will silently leave `claude.ts` (and any future provider) broken in the same way.

Checklist when touching sandbox paths:
1. Does `buildWritableRoots` in `policy.ts` include every path the change requires? If so, both providers benefit automatically.
2. If a router adds or removes paths *after* calling `resolveSandboxPolicy`, verify the same adjustment is made (or is intentionally absent) in every other router.
3. For OpenSpec-specific restrictions (`resolveOpenSpecCodexToolConfig`), confirm that `evaluateOpenSpecToolPolicy` enforces the equivalent rule on the Claude side so both providers block the same tool calls.

### Electron drag regions (`WebkitAppRegion`)

The frameless window relies on `WebkitAppRegion: 'drag'` (inline style; the type augmentation lives at `src/renderer/css.d.ts`) to mark areas that move the window. Any interactive control rendered **inside or under** a drag region is non-clickable — the OS captures the click for window movement before the renderer sees it. To make a control clickable, add `style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}` to its wrapper.

The settings dialog (`features/settings/settings-content.tsx`) overlays the **top ~48 px of every tab** with an absolute `WebkitAppRegion: 'drag'` bar so users can move the window from above tab content. Anything actionable that renders in that zone — search inputs, add/refresh buttons, detail-panel toggles — needs the no-drag opt-out on its wrapper. Existing examples: the search/+ rows in every two-panel settings tab (Projects, Skills, Custom Agents, MCP, Plugins, Keyboard) and the Disabled/Active toggle in the plugin-detail header (`agents-plugins-tab.tsx`).

## Resetting App State

To simulate a clean install (wipe database, settings):

```bash
# Clear all app data (database, settings)
rm -rf ~/Library/Application\ Support/Churro\ Coder\ Dev/  # Dev mode
rm -rf ~/Library/Application\ Support/Churro\ Coder/        # Production

# Run in dev mode with clean state
bun run dev
```

**Dev vs Production App:**
- Dev mode uses separate userData path (`~/Library/Application Support/Churro Coder Dev/`)
- This prevents conflicts between dev and production installs
