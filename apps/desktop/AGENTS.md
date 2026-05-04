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

# AGENTS.md (apps/desktop)

This file is the canonical agent guide for the Electron desktop app. `CLAUDE.md` next to it is a symlink — edit this file, not the symlink. The `OPENSPEC:START`/`OPENSPEC:END` block above is managed by `openspec update`; leave it intact.

## What is this?

**Churro Coder** - A local-first, fully offline Electron desktop app for AI-powered code assistance. Users create chat sessions linked to local project folders, interact with Claude in Plan or Agent mode, and see real-time tool execution (bash, file edits, web search, etc.). All functionality runs on-device — no login, no cloud sync, no analytics.

## Commands

This app is bun-managed; do not run `pnpm install` here. From the monorepo root the same flows are also available via Nx (`pnpm exec nx run desktop:dev` / `:build` / `:dist` / `:package`), which shells back into these scripts.

**Do not run typechecking from agents.** There is no `typecheck` script, and `ts:check` shells out to `tsgo` (`@typescript/native-preview`) which is not installed in this checkout — it exits 127. `bunx tsc --noEmit` "works" but the project has many pre-existing unrelated errors (third-party SDK incompatibilities, drizzle/tRPC narrowing) that drown out anything new, so the signal isn't useful. Verify changes by running the app (`bun run dev`) and exercising the affected feature in the UI instead.

```bash
# Development
bun run dev              # Start Electron with hot reload (electron-vite)

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

# Database (Drizzle + SQLite)
bun run db:generate      # Generate migrations from schema
bun run db:push          # Push schema directly (dev only)
bun run db:studio        # Open Drizzle Studio against the local DB

# Misc
bun run icon:generate    # Regenerate platform icon set from build/icon source
```

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry, window lifecycle
│   ├── auth-manager.ts      # Offline auth stub — always returns user@local
│   ├── auth-store.ts        # Encrypted credential storage (safeStorage)
│   ├── windows/main.ts      # Window creation, IPC handlers
│   └── lib/
│       ├── db/              # Drizzle + SQLite
│       │   ├── index.ts     # DB init, auto-migrate on startup
│       │   ├── schema/      # Drizzle table definitions
│       │   └── utils.ts     # ID generation
│       └── trpc/routers/    # tRPC routers (projects, chats, claude)
│
├── preload/                 # IPC bridge (context isolation)
│   └── index.ts             # Exposes desktopApi + tRPC bridge
│
└── renderer/                # React 19 UI
    ├── App.tsx              # Root with providers
    ├── features/
    │   ├── layout/          # Outer 3-cell gridview shell
    │   │   ├── agents-layout.tsx   # GridviewReact (left rail / center / right rail) +
    │   │   │                       # system-view overlay + per-workspace dock-shell wiring
    │   │   └── details-rail.tsx    # Right-rail widget host (workspace-scoped)
    │   ├── dock/            # dockview-react windowing system (new in this refactor)
    │   │   ├── dock-shell.tsx              # DockviewReact instance + onDidRemovePanel cleanup
    │   │   ├── workspace-dock-shell.tsx    # One per visited workspace; visibility-toggled
    │   │   ├── chat-panel-sync.tsx         # Reconciles dockview chat:* panels w/ store
    │   │   ├── dock-context.tsx            # DockProvider exposing active workspace's dockApi
    │   │   ├── panel-registry.tsx          # kind → React component map
    │   │   ├── panels/      # chat, terminal, file, plan, diff, search, files-tree, main
    │   │   ├── atoms.ts     # mountedWorkspaceIdsAtom, widgetPanelMapAtom, etc.
    │   │   ├── persistence.ts              # Per-workspace dock + global shell snapshots
    │   │   ├── use-panel-actions.ts        # newSubChat / openTerminal / openDiff / etc.
    │   │   ├── use-widget-panel.ts         # Widget ↔ panel mutex hook
    │   │   ├── add-or-focus.ts             # Idempotent "add or focus existing" helper
    │   │   ├── renamable-tab.tsx           # Default tab component (rename, icons, close)
    │   │   ├── chat-tab-archive.tsx        # Confirm-on-close for chat tabs
    │   │   ├── terminal-tab-close.tsx      # Confirm-on-close for terminal tabs
    │   │   ├── dock-header-actions.tsx     # [+] / Chat / Terminal in tab strip right side
    │   │   ├── dock-header-left-actions.tsx # Hamburger toggle in tab strip left side
    │   │   └── dock-hotkeys-host.tsx       # Bridges agent actions → panel actions
    │   ├── agents/          # Chat interface (no longer owns layout)
    │   │   ├── main/        # active-chat.tsx, new-chat-form.tsx
    │   │   ├── ui/          # Tool renderers, agents-content, agent-diff-view, …
    │   │   ├── commands/    # Slash commands (/plan, /agent, /clear)
    │   │   ├── atoms/       # Jotai atoms for agent state
    │   │   ├── hooks/       # use-workflow-state.ts (workflow state + action dispatch)
    │   │   ├── stores/      # Zustand store for sub-chats (kept; metadata source)
    │   │   ├── lib/         # agents-actions.ts, agents-hotkeys-manager.ts, model-switching.ts
    │   │   └── utils/       # pr-message.ts (PR / review prompt generators) +
    │   │                    # workflow-state.ts (pure Plan→Code→Review→PR state machine)
    │   ├── details-sidebar/ # Right-rail widgets (Status, Plan, Changes, Terminal, MCP, …)
    │   │   └── sections/    # Each widget + PromotedToPanelStub
    │   ├── changes/         # Diff viewer (ChangesPanel, AgentDiffView, DiffSidebarHeader)
    │   ├── file-viewer/     # Code / Markdown / Image viewers
    │   ├── terminal/        # xterm + node-pty wiring
    │   ├── sidebar/         # Workspace list (left rail body)
    │   ├── kanban/          # System-wide Kanban view
    │   ├── automations/, settings/, usage/    # Other system-wide views
    │   ├── onboarding/      # First-run / account-connect flows
    │   ├── spotlight/       # Cmd-K palette
    │   ├── mentions/        # @-mention picker (files, agents, etc.)
    │   └── ...
    ├── components/ui/       # Radix UI wrappers (button, dialog, etc.)
    └── lib/
        ├── atoms/           # Global Jotai atoms
        ├── stores/          # Global Zustand stores
        ├── trpc.ts          # tRPC client
        ├── jotai-store.ts   # Default jotai store (used for atom reads outside React)
        └── hotkeys/         # Shortcut registry + keydown manager
```

## Database (Drizzle ORM)

**Location:** `{userData}/data/agents.db` (SQLite)

**Schema:** `src/main/lib/db/schema/index.ts`

```typescript
// Core tables:
projects                  → id, name, path, git remote (provider/owner/repo), iconPath, timestamps
chats                     → id, name, projectId, worktreePath, branch, baseBranch, prUrl, prNumber, archivedAt, timestamps
sub_chats                 → id, name, chatId, sessionId, streamId, mode, messages (JSON),
                            cached fileStats {additions, deletions, fileCount}, timestamps

// Auth / accounts:
claude_code_credentials   → DEPRECATED single-row OAuth token store (kept for migration)
anthropic_accounts        → Multi-account OAuth tokens (encrypted via safeStorage)
anthropic_settings        → Singleton row tracking the active anthropic account
```

`chats.archivedAt` is set but `chats.list` filters it out; archived-chat listing/restoration endpoints have been removed.

**Auto-migration:** On app start, `initDatabase()` runs migrations from `drizzle/` folder (dev) or `resources/migrations` (packaged).

**Queries:**
```typescript
import { getDatabase, projects, chats } from "../lib/db"
import { eq } from "drizzle-orm"

const db = getDatabase()
const allProjects = db.select().from(projects).all()
const projectChats = db.select().from(chats).where(eq(chats.projectId, id)).all()
```

## Key Patterns

### IPC Communication
- Uses **tRPC** with `trpc-electron` for type-safe main↔renderer communication
- All backend calls go through tRPC routers, not raw IPC
- Preload exposes `window.desktopApi` for native features (window controls, clipboard, notifications)

### State Management
- **Jotai**: UI state (selected chat, sidebar open, preview settings)
- **Zustand**: Sub-chat tabs and pinned state (persisted to localStorage)
- **React Query**: Server state via tRPC (auto-caching, refetch)

### Claude Integration
- Dynamic import of `@anthropic-ai/claude-agent-sdk` SDK
- Two modes: "plan" (read-only) and "agent" (full permissions)
- Session resume via `sessionId` stored in SubChat
- Message streaming via tRPC subscription (`claude.onMessage`)

### Windowing (dockview-react)
- Outer **gridview** with three cells: left rail (workspace list) / center (DockviewReact) / right rail (Details widgets). Center is the only resizable workspace surface; the rails are fixed columns with their own visibility toggles.
- One **`WorkspaceDockShell`** per workspace the user has visited this session, all stacked absolutely in the center cell. Active shell is `opacity-1 / pointer-events-auto`; the rest are `opacity-0 / pointer-events-none` (NOT `display:none` — that breaks dockview's `ResizeObserver`). Switching workspaces is a CSS toggle, so terminals, chat streams, xterm scrollback, and form drafts all survive.
- Each workspace's panels (`chat:${subChatId}`, `terminal:${paneId}`, `file:${absolutePath}`, `plan:${chatId}:${planPath}`, `diff:${chatId}`, `search:${projectId}`, `files-tree:${projectId}`) carry a stable id derived from the underlying entity. Layout serializes via `dockApi.toJSON()`.
- **System views** (Settings / Usage / Kanban / Automations / Inbox / New Workspace) are rendered as an absolute overlay on the center cell when `useEffectiveSystemView()` returns non-null. They cover the dockview rather than mounting inside a panel.
- **Widget ↔ panel mutex**: each expandable Details widget (Plan / Changes / Terminal) uses `useWidgetPanel(widgetId, entity)` to swap to a `<PromotedToPanelStub />` when promoted to a dockview panel. `widgetPanelMapAtom` is the single source of truth.
- **Persistence**: shell layout (gridview) is global at `agents:shell:v3`; dock layout is per-workspace at `agents:dock:project:${id}` (or `agents:dock:no-workspace`). Schema bumps invalidate older saved layouts.
- **Option B contract**: only the *active* workspace's `ChatPanelSync` runs (gated by an `active` prop), and only the active workspace's `ChatView` writes to the global sub-chat store (gated by `chatId === selectedChatId`). Don't break this — inactive workspaces clobber the active slice if they leak.

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron ~39.4, electron-vite, electron-builder |
| UI | React 19, TypeScript 5.4.5, **Tailwind CSS v3** (NOT v4), dockview-react, Monaco editor |
| Components | Radix UI, Lucide icons, Motion, Sonner |
| State | Jotai, Zustand, React Query |
| Backend | tRPC (`trpc-electron`), Drizzle ORM, better-sqlite3 |
| AI | `@anthropic-ai/claude-agent-sdk`, bundled Codex CLI `app-server`, `@modelcontextprotocol/sdk` (MCP) |
| Terminal | xterm + addons, node-pty |
| Package Manager | bun (Nx wraps it from the monorepo root) |

### Tailwind v3 (not v4)

Pinned at `tailwindcss@^3.4.17`. Do **not** add Tailwind v4 syntax to CSS files or tooling — `globals.css` once contained an `@source "../../../node_modules/streamdown/dist/*.js";` directive (v4-only), and v3's PostCSS plugin passed it through to the bundled output verbatim, where the production CSS optimizer choked on the unknown `@`-rule and silently dropped or mangled the rules around it. Symptom: `bun run dev` looks fine, `bun run build` produces a CSS file that's missing dockview chrome / shell gaps / pill tabs. To include Tailwind classes from a third-party package, add the package's dist path to the `content` array in `tailwind.config.js` (already done for `streamdown`).

## File Naming

- Components: PascalCase (`ActiveChat.tsx`, `AgentsSidebar.tsx`)
- Utilities/hooks: camelCase (`useFileUpload.ts`, `formatters.ts`)
- Stores: kebab-case (`sub-chat-store.ts`, `agent-chat-store.ts`)
- Atoms: camelCase with `Atom` suffix (`selectedAgentChatIdAtom`)

## Important Files

**Build / config**
- `electron.vite.config.ts` - Build config (main/preload/renderer entries)
- `build.sh` - Cross-platform packaging script (uses `set -euo pipefail`)

**Backend**
- `src/main/index.ts` - App entry; `before-quit` sweeps empty unnamed sub-chats
- `src/main/lib/db/schema/index.ts` - Drizzle schema (source of truth)
- `src/main/lib/db/index.ts` - DB initialization + auto-migrate
- `src/main/lib/trpc/routers/claude.ts` - Claude SDK integration
- `src/main/lib/trpc/routers/chats.ts` - chats / sub-chats CRUD + diff endpoints
- `src/main/lib/trpc/routers/changes.ts` - git status / branches / PR creation

**Renderer — layout**
- `src/renderer/App.tsx` - Root providers
- `src/renderer/features/layout/agents-layout.tsx` - Outer gridview shell + system-view overlay + per-workspace dock-shell wiring
- `src/renderer/features/dock/workspace-dock-shell.tsx` - One DockShell per workspace
- `src/renderer/features/dock/dock-shell.tsx` - DockviewReact instance + onDidRemovePanel cleanup
- `src/renderer/features/dock/panel-registry.tsx` - Component map for every panel kind
- `src/renderer/features/dock/persistence.ts` - Per-workspace + global layout snapshots
- `src/renderer/features/dock/use-panel-actions.ts` - Single source of truth for "open a panel" flows

**Renderer — chat**
- `src/renderer/features/agents/main/active-chat.tsx` - ChatView (~7.1k LOC after the Phase 3 cuts — diff-sidebar module + chat-toolbar + terminal-bottom-mount + the three earlier component cuts removed ~1600 LOC of UI code from this file; Phase 2 services landed but not yet wired in — see "Refactor playbook" + "Phase 3 wiring contract" below)
- `src/renderer/features/agents/atoms/index.ts` - Agent UI state atoms (incl. the `pendingXxxMessageAtom` family)
- `src/renderer/features/agents/stores/sub-chat-store.ts` - Per-workspace `openSubChatIds` / `activeSubChatId`
- `src/renderer/features/agents/lib/agents-actions.ts` - Hotkey-driven action handlers
- `src/renderer/features/agents/lib/agents-hotkeys-manager.ts` - keydown listener + shortcut → action map
- `src/renderer/features/agents/lib/model-switching.ts` - `applyModeDefaultModel(subChatId, mode)` — flips per-subChat model + thinking level
- `src/renderer/features/agents/machines/chat-mode-machine.ts` - Pure FSM for chat mode + activity (idle / sending / streaming / errored)
- `src/renderer/features/agents/machines/plan-approval-machine.ts` - Pure FSM for `handleApprovePlan` (single-flight + same/cross-provider branches)
- `src/renderer/features/agents/machines/transport-lifecycle.ts` - Pure decision logic for `getOrCreateChat` + plan-approval cross-provider recreate
- `src/renderer/features/agents/services/plan-approval-service.ts` - `approvePlan(subChatId, deps)` — wraps the plan-approval FSM with injected side-effect deps (covered by 24 L2 tests + 11 integration tests across 5 PRs)
- `src/renderer/features/agents/services/mode-switch-service.ts` - `toggleMode` / `forceMode` / `hydrateMode` — gates the mode atom + DB persist on the chat-mode FSM (PR #36 + PR #51 invariants)
- `src/renderer/features/agents/services/chat-send-service.ts` - `sendPendingMessage` / `drainFirstPending` — collapses the six `pendingXxxMessageAtom` consumer effects into one function with clear-before-await invariant
- `src/renderer/features/agents/services/transport-factory.ts` - `getOrCreateChat(input, deps)` — wraps `decideTransportAction` with the cache + transport constructor injection; replaces `instanceof CodexChatTransport` checks
- `src/renderer/features/agents/components/message-group.tsx` - User-message-height measurement + `content-visibility: auto` perf wrapper, extracted from `active-chat.tsx` in Phase 3
- `src/renderer/features/agents/components/scroll-to-bottom-button.tsx` - Sticky scroll-to-bottom button with isolated scroll listener (RAF-throttled), extracted in Phase 3
- `src/renderer/features/agents/components/split-pane-inline-close.tsx` - Persistent close button for split-pane chats, extracted in Phase 3
- `src/renderer/features/agents/components/chat-toolbar.tsx` - Title row + workspace subtitle (chat header), extracted in Phase 3
- `src/renderer/features/agents/components/terminal-bottom-mount.tsx` - Bottom-panel mount for `TerminalBottomPanelContent`, extracted in Phase 3
- `src/renderer/features/agents/components/diff-sidebar.tsx` - Diff-sidebar module: `DiffStateProvider` + `DiffSidebarRenderer` + the internal `DiffSidebarContent`/`CommitFileItem` + `useDiffState` context. ~900 LOC moved out of `active-chat.tsx` in one cohesive surgery

**Testing**
- `vitest.config.ts` - Test config (node env default; per-file `// @vitest-environment jsdom` for component tests). Pure modules + service modules go in the `coverage.include` array
- `vitest.setup.ts` - localStorage stub so jotai's `atomWithStorage` works in node
- `test-utils/` - Shared test helpers: `renderWithProviders`, `createTestStore`, `createMockTransport`, `createMockTrpc`. Import via `import { ... } from "../../../../../test-utils"` (or set up an alias if you find yourself reaching deep)
- `src/renderer/features/agents/services/*.test.ts` - L2 service tests (68 tests) — see "Test battery" below
- `src/renderer/features/agents/__tests__/integration/*.test.ts` - L4 integration flow tests (19 tests; see `__tests__/integration/README.md` for the per-flow PR mapping)

**Renderer — workflow / status**
- `src/renderer/features/agents/utils/workflow-state.ts` - **Pure** Plan→Code→Review→PR state machine (no React/jotai/tRPC)
- `src/renderer/features/agents/hooks/use-workflow-state.ts` - `useWorkflowState` + `useWorkflowActions` (atoms + tRPC → state machine; central dispatcher)
- `src/renderer/features/details-sidebar/sections/status-widget.tsx` - 4-pill stepper UI
- `src/renderer/features/agents/ui/sub-chat-status-card.tsx` - Notch above chat input (chip + primary button, both from `workflow.next`)
- `src/renderer/features/details-sidebar/atoms/index.ts` - `localReviewCompletedAtomFamily` / `planEverGeneratedAtomFamily` / `prCreatingAtomFamily`

**Renderer — diff / changes**
- `src/renderer/features/changes/changes-panel.tsx` - File list + commit panel (Changes / History tabs)
- `src/renderer/features/agents/ui/agent-diff-view.tsx` - Line-by-line diff viewer
- `src/renderer/features/changes/components/diff-sidebar-header/diff-sidebar-header.tsx` - Branch + Review / Publish / Merge / kebab toolbar

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

**Common First-Install Bugs:**
- **Folder dialog not appearing**: Window focus timing issues on first launch. Fixed by ensuring window focus before showing `dialog.showOpenDialog()`.

## Releasing a New Version

### Prerequisites for Notarization

- Keychain profile: `churrostack-notarize`
- Create with: `xcrun notarytool store-credentials "churrostack-notarize" --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID`

### Release Commands

```bash
# Step by step:
bun run build              # Compile TypeScript
bun run package:mac        # Build & sign macOS app (produces DMGs in release/)
```

### Bump Version Before Release

```bash
npm version patch --no-git-tag-version  # 0.0.27 → 0.0.28
```

### After Package Completes

1. Wait for notarization (2-5 min): `xcrun notarytool history --keychain-profile "churrostack-notarize"`
2. Staple DMGs: `cd release && xcrun stapler staple *.dmg`
3. Distribute DMGs manually or via the CDN release flow (`bun run release`).

### Auto-update

Auto-update is wired up via `electron-builder`'s `generic` provider:
- `electron-builder.yml` / `package.json#build.publish.url` points at `https://cdn.churrostack.com/releases/desktop`.
- `bun run dist:manifest` (`scripts/generate-update-manifest.mjs`) produces the latest-mac/win/linux YAML manifests.
- `bun run dist:upload` (or `scripts/upload-release-wrangler.sh`) pushes artifacts + manifests to the CDN bucket.
- The renderer-side updater lives at `src/main/lib/auto-updater.ts`.

The `release` script chains `build → package:mac → dist:manifest → upload-release-wrangler.sh` so a normal release is one command.

## Current Status

**Done (this branch — Phase 2 services + L4 integration battery + Phase 3 complete):**
- Four services in `src/renderer/features/agents/services/`: `plan-approval-service`, `mode-switch-service`, `chat-send-service`, `transport-factory`. Each composes the corresponding pure machine with injected side-effect deps so the orchestration is testable end-to-end without React/jotai/tRPC.
- 68 L2 service tests across 4 files — encode invariants from PRs #36 / #38 / #40 / #44 / #45 / #51 / #52. See the bug-cluster regression matrix below.
- 19 L4 integration tests in `src/renderer/features/agents/__tests__/integration/`: `flow-plan-to-agent`, `flow-cross-provider-approve`, `flow-mode-toggle-mid-stream`, `flow-stale-hydration`, `flow-session-clear-after-approve`.
- **Phase 3 complete** — all extractable components moved out of `active-chat.tsx`:
  - `MessageGroup` → `components/message-group.tsx`
  - `SplitPaneInlineClose` → `components/split-pane-inline-close.tsx`
  - `ScrollToBottomButton` → `components/scroll-to-bottom-button.tsx`
  - `ChatToolbar` → `components/chat-toolbar.tsx`
  - `TerminalBottomMount` → `components/terminal-bottom-mount.tsx`
  - **`diff-sidebar` module** → `components/diff-sidebar.tsx` — bundled `DiffStateProvider`, `DiffSidebarRenderer`, `DiffSidebarContent`, `CommitFileItem`, and the `useDiffState` context (~900 LOC moved as one cohesive surgery).
  - 15 L3 component tests (jsdom + RTL) for the simpler ones.
- **Phase 3 closed entries** — `streaming-status-indicator`, `pending-files-strip`, `chat-input-bar`, `chat-message-list`, `empty-state`, and `plan-panel-inline` from the original playbook had no extractable block in `active-chat.tsx` because they were already extracted (`AgentSendButton`, `ChatInputArea`, `IsolatedMessagesSection`) or the playbook entry was speculative.
- **Dead-code purged from `active-chat.tsx`**: `CopyButton`, `PlayButton` (with `PlayButtonState` / `PLAYBACK_SPEEDS` / `PlaybackSpeed` types), `CollapsibleSteps`, and the unused `ttsPlaybackRate` state were all dead code — the live versions live in `ui/message-action-buttons.tsx` and `main/assistant-message-item.tsx`. Removing them + the Phase 3 cuts shrunk the file from 8730 → 7117 LOC (~1600 LOC removed) and let us drop ~24 now-unused imports.
- `vitest.config.ts` `coverage.include` extended for the four service modules + the three new component modules with tests.
- AGENTS.md gained a maintenance plan, a bug-cluster regression matrix, a Phase 3 wiring contract (service-by-service deps wiring guide), and a Phase 3 component extraction order.
- `bun run build` clean. 444/444 tests pass.

**Done (previous branch — Status widget):**
- Pure `computeWorkflowState` state machine (`agents/utils/workflow-state.ts`) — single source of truth for Plan / Code / Review / PR milestones + `next` action.
- `useWorkflowState` + `useWorkflowActions` hooks (`agents/hooks/use-workflow-state.ts`) — wire jotai/tRPC → state machine and centralize the dispatch path.
- New right-rail Status widget (4-pill stepper) and refactored notch above the chat input — both consume the same `WorkflowState`.
- `pendingMergeBaseMessageAtom` (cross-component "merge from base" prompt) added alongside the existing `pendingPrMessageAtom` / `pendingReviewMessageAtom` / `pendingConflictResolutionMessageAtom`.
- `GitChangesStatus.hasRemote` (no-remote vs no-upstream distinction) and `getPrStatus.baseBranchBehind` (with quiet `git fetch` so the count is fresh).
- PR widget's "Review pending" / "Changes requested" rows are clickable and reuse the same `reviewPr` dispatch path.
- Plan dockview panel (`PlanPanel`) gained an Approve button (writes `pendingBuildPlanSubChatIdAtom` — same atom the sidebar widget uses; closes the panel + activates the chat panel after approve) and made its content scrollable when full-height.
- `applyModeDefaultModel(subChatId, "review")` is invoked synchronously **before** any `await` in all three review entry points so the chat input visibly flips to the configured review model before the prompt is sent.
- Diff panel header's Review button is no longer gated on `diffStats.hasChanges` — it's available whenever an `onReview` handler is wired (in-memory diff cache resets on reload and never lights up for untracked-only fresh repos).

**Done (previous branch — windowing refactor):**
- Outer gridview shell (left rail / center / right rail).
- DockviewReact center cell with stable-id panels for chat / terminal / file / plan / diff / search / files-tree.
- Per-workspace `WorkspaceDockShell`s, visibility-toggled — terminal PTYs and chat streams survive workspace switches.
- Per-workspace dock layout persistence + global shell layout (schema v3).
- Widget ↔ panel mutex (Plan / Changes / Terminal).
- Renamable tabs, per-kind tab icons, last-tab close guard, confirm-on-close for chat & terminal tabs.
- Per-group `[+]` / Chat / Terminal header actions.
- Hotkeys: ⌘T (new chat), ⌘⇧T (new terminal), ⌘P (file picker), ⌘⇧F (search), ⌘D (open Changes panel).
- System-view overlay for Settings / Usage / Kanban / Automations / Inbox / New Workspace.
- Diff panel: ChangesPanel + AgentDiffView + DiffSidebarHeader, with Review / Create PR / Merge / Fix-conflicts wired.

**Done (this branch — deps hooks + composer + L4 form-binding):**
- **`flow-form-binding-on-new-subchat.test.ts`** — 7 L4 tests covering PR #38 regression class. Closes the L4 gap from the original plan. Drives the real `applyModeDefaultModel` via `mode-switch-service.toggleMode` to verify per-mode default propagation, sync ordering (PR #36), cross-provider defaults, and per-subChatId isolation (PR #51).
- **`useModeSwitchDeps`** hook — extracted the mode-switch service deps from `ChatViewInner`. The renderer now calls `useModeSwitchDeps(updateSubChatModeMutation)` instead of building the deps inline.
- **`useTransportFactoryDeps`** hook — extracted the ~280 LOC factory deps block (FSM-decision deps + the 140-LOC `createChat` callback with onError/onFinish lifecycle hooks) from `getOrCreateChat`. The renderer's `getOrCreateChat` is now a thin caller around the FSM decision + the deps from this hook. Reduced `active-chat.tsx` by ~270 LOC.
- **`useApprovePlanDeps`** hook — extracted the ~80 LOC plan-approval deps from `handleApprovePlan`. The renderer's `handleApprovePlan` is now a 5-line wrapper around `approvePlanService(subChatId, planDeps)`. Reduced `active-chat.tsx` by ~110 LOC.
- **`useChatController`** composer hook — the public API the original plan called out as "composes all hooks for active-chat.tsx". Bundles `useChatViewState` + the three deps hooks into a single typed return. The renderer keeps its individual hook calls (the per-call inputs are scattered across the file), but components extracted from `ChatViewInner` will use the composer to get everything per-subChatId in one shot.
- **L3.5 hook tests** for the controller (7 tests): mount, return-shape contract, viewState read/write, per-subChatId isolation, persistMode skip-temp-id behavior, persistMode awaits the mutation. Uses structural mocks for the IPC/Codex/Remote transports so the test runs in node without an electronTRPC global.
- **`lib/chat-instance-helpers.ts`** — pure helpers (`parseStoredMessages`, `getChatMessages`, `shouldRecreateStaleRuntimeChat`) lifted out of `active-chat.tsx` so the transport-factory hook can import them without circling back through the renderer.
- **`lib/implement-plan-parts.ts`** — `IMPLEMENT_PLAN_BASE_TEXT` + `buildImplementPlanParts` + `ApprovedPlanContent` lifted out of `active-chat.tsx` for the approve-plan hook.
- **`active-chat.tsx` LOC: 7,389 → 7,006** (~383 LOC removed via deps-hook extractions; behavior unchanged).

**Done (previous — Phase 2 fully wired + L3.5 hook layer):**
- All four Phase 2 services are now wired through `ChatViewInner`:
  - **`chat-send-service.sendPendingMessage`** — the six near-identical pending-message effects (`pendingPrMessage`, `pendingReviewMessage`, `pendingConflictResolutionMessage`, `pendingMergeBaseMessage`, `pendingContinueMessage`, `pendingImplementPlan`) collapse to a single 3-line call each via a `sendPending` wrapper. Clear-before-await invariant sourced from the service.
  - **`mode-switch-service.hydrateMode`** — the `dbSubChats` initialization loop now hydrates each sub-chat through the FSM exactly once (tracked in `hydratedSubChatIdsRef`). PR #51 stale-refetch race is locked in by the FSM's hydrationVersion guard, not the legacy `knownModes[id] === undefined` check.
  - **`mode-switch-service.toggleMode`** — `handleModeChange` (the user-toggle entry point) goes through the service, which adds three invariants the legacy code missed: PR #36 sync-before-await, PR #38 per-mode default propagation, PR #51 activity-gate against mid-stream toggles. A new effect maps `useChat.status` → FSM events (`noteSendRequested` / `noteStreamStarted` / `noteStreamCompleted` / `noteStreamErrored`) so the activity gate has live data.
  - **`transport-factory.getOrCreateChat`** — replaces the imperative branching with the FSM in `decideTransportAction`. Behavior parity verified: existing+remote → KEEP, stale+idle → RECREATE, provider match → KEEP, cross-provider with messages → KEEP (PR #44), cross-provider empty → RECREATE. The 140-LOC `createChat` callback (Chat instantiation + onError/onFinish) lives inline as a dep so tests can substitute a mock transport.
  - **`plan-approval-service.approvePlan`** — replaces `handleApprovePlan` entirely. The renderer wires deps; every invariant from PRs #36, #38, #40, #44, #45, #51, #52 lives in the service. `buildImplementPlanParts` adapts the FSM's `ImplementPlanPayload` back into the renderer's existing helper for the file-content layout.
- New atom: `chatModeFsmStateAtomFamily(subChatId)` — per-subChatId FSM state container shared by all the mode/plan services as their `readState` / `writeState` deps. In-memory only; derivable from `subChatModeAtomFamily` + `useChat.status` after a fresh launch.
- `useChatViewState(subChatId)` hook landed in `agents/hooks/use-chat-view-state.ts`. Bundles the per-subChatId **configuration** atoms (`mode`, `modelId`, `codexModelId`, `codexThinking`, `claudeThinking`, `providerOverride`) with their setters into a single typed return. Components extracted from ChatViewInner can call the hook to read the same slice without re-deriving each atomFamily binding.
- L3.5 hook test layer: `agents/hooks/use-chat-view-state.test.tsx` (7 tests) — covers default values, individual setters, per-subChatId isolation, and the PR #51-style cross-subchat bleed regression class. Uses `renderHook` from RTL with a fresh jotai store per test.

**Known limitations / deferred:**
- `active-chat.tsx` LOC went from ~7.1k to ~7.4k (the deps blocks add overhead). The wins aren't LOC — they're: (a) every imperative path is now a thin wrapper around an L2-tested service; (b) the bug-cluster invariants (PRs #36–#52) live in the service code, not the renderer; (c) future PRs touching mode/plan/transport edit the service tests, not the renderer. Further LOC reduction would require extracting the renderer's deps wiring into hooks (e.g., `useApprovePlanDeps(subChatId)`, `useTransportFactoryDeps(...)`) — small, safe follow-ups.
- The chat-mode FSM activity tracking is wired, but the toggle UI in `chat-input-area.tsx` doesn't yet gate on `activity === "idle"` — it gates on `useChat.status` directly. The service silently rejects busy toggles with a `console.warn`. UI gating is a small follow-up.
- `useChatViewState` is the **configuration** slice only — activity flags (`isStreaming`, error state), pending-message atoms (now wired through the send service but still subscribed in ChatViewInner), and FSM state have different lifecycles and live elsewhere. The hook is intentionally narrow so the test surface stays focused.
- Mobile branch (`agents-content.tsx if (isMobile)`) still uses legacy `TerminalSidebar` / `KanbanView` dispatch — unaudited against the dockview changes.
- Display-mode atoms (`terminalDisplayModeAtom`, `diffViewDisplayModeAtom`, `fileViewerDisplayModeAtom` + `*SidebarOpenAtomFamily` siblings) are vestigial but still consumed by `changes-view.tsx` / `agent-diff-view.tsx` / `git-activity-badges.tsx` / `agent-plan-file-tool.tsx` / mobile `terminal-sidebar.tsx`. Removal is a 7-file follow-up.
- `chats.listArchived` / `chats.restore` / `chats.deleteAllArchived` were removed; Cmd+Z workspace undo is a no-op (sub-chat undo still works). The `archived_at` column remains in the schema and is filtered out by `chats.list`.
- `mock-api.ts` still wraps `trpc.chats.listArchived` / `restore` but has no live consumers — TypeScript-only.
- Several pre-existing hotkeys (`prev-agent`, `next-agent`, `archive-workspace`, `archive-agent`, etc.) lack handlers in `AGENT_ACTIONS`. Not introduced by this refactor.

## Multi-Provider Interleaved Conversations

Users can switch between Claude and Codex mid-conversation within the same sub-chat tab. The provider change is tracked in `subChatProviderOverrides` (local React state in `active-chat.tsx`); switching destroys and recreates the transport via `agentChatStore.delete(subChatId)`.

### Catch-up mechanism

When the active provider differs from the one that produced recent turns, a `[CATCHUP]` block is prepended to the outgoing prompt so the new provider has context. **The block is sent to the live provider only — it is never persisted to the DB.**

Key files:
- `src/shared/provider-from-model.ts` — `getProviderForModelId(modelId)` classifies any model ID as `"claude-code" | "codex"`. Import this from both main and renderer; do NOT duplicate the logic.
- `src/main/lib/multi-provider/catchup.ts` — pure `computeCatchupBlock(messages, provider, options?)`. Call it with the full `messagesForStream` array (including the trailing user message being sent); it strips the trailing user before searching for the provider boundary. Pass `{ forceFullHistory: true }` when the session is known to be fresh/expired.
- `src/main/lib/trpc/routers/claude.ts` — catch-up wired just before `queryOptions` assembly. Proactively checks if the session JSONL file exists; if missing, clears `resumeSessionId` and sets `isSessionFresh = true` so `forceFullHistory` fires.
- `src/main/lib/trpc/routers/codex.ts` — catch-up wired just before `turn/start`.

### Critical invariants — do not break

- **Boundary search excludes the trailing user message.** The trailing Codex user message (with `metadata.model = "gpt-5.4/high"`) would otherwise be found first and set `boundaryIdx` to the last position, making the catch-up window empty.
- **`getLastSessionId` in the Codex router only returns Codex thread IDs.** It filters to assistant messages where `getProviderForModelId(metadata.model) === "codex"` so Claude session UUIDs are not passed to app-server `thread/resume`.
- **The Codex router treats `input.sessionId` as a fallback only.** The renderer reads `sessionId` from the last AI SDK assistant message, which after a Claude turn can be a Claude UUID. Prefer the in-process `subChatId -> threadId` map, then DB-resident `getLastSessionId(existingMessages)`.
- **Codex UI model IDs use `"baseModel/thinkingLevel"` format** (e.g. `"gpt-5.4/high"`). Split this into `model` and `effort` when calling app-server.

### Codex cost computation

`CODEX_MODEL_PRICING` in `src/main/lib/codex/usage-metadata.ts` maps base model IDs (suffix stripped) to per-1M-token input/cached-input/output rates. Cost is computed in `mapAppServerUsageToMetadata` and stored as `totalCostUsd` in the assistant message metadata — the same field Claude uses — so the recap UI renders it identically.

## Workflow Status state machine

The right-rail **Status widget** (4-pill stepper: Plan → Code → Review → PR) and the **notch** above the chat input (chip + primary button) are both driven by a single pure state machine. There is no per-component logic for "what's the next step" — both surfaces consume the same `WorkflowState` and dispatch through the same `useWorkflowActions`.

### Pure state machine — `agents/utils/workflow-state.ts`

`computeWorkflowState(inputs: WorkflowInputs): WorkflowState` is **dependency-free** (no React, no jotai, no tRPC). It maps inputs → 4 milestones (each with `status: idle | in_progress | attention | info | done`) plus a single `next` action. Don't add React/jotai/tRPC imports here — that breaks unit testability and creates circular ownership with the hook.

Status semantics (color is a hint, not a strict rule):

| Status        | Color           | Meaning                          | Example                                    |
|---------------|-----------------|----------------------------------|--------------------------------------------|
| `idle`        | gray            | Future / not relevant            | "Plan" in agent-mode chats                 |
| `in_progress` | blue (animated) | AI/system is working             | "Code" while agent is editing              |
| `attention`   | amber           | User action required             | "Plan ready — approve" / "Push branch"     |
| `info`        | blue            | Informational, not blocking      | PR is open, awaiting reviewer              |
| `done`        | green           | Completed                        | Plan approved / code pushed / PR merged    |

`next` selection cascades: first milestone (in order plan → code → review → pr) whose status is `attention` *with* an `actionKind`, falling back to the first `in_progress` *with* an `actionKind`. This guarantees only **one** milestone owns the "next" slot at any time — no two pills can simultaneously claim it.

`computeCode` reads `plan.status` and `computeReview` reads `code.status` and `computePr` reads both — the cascade is the only coupling between milestones.

### React glue — `agents/hooks/use-workflow-state.ts`

Two hooks:

- **`useWorkflowState(chatId, subChatId) → WorkflowState | null`** — reads jotai atoms (`subChatModeAtomFamily`, `loadingSubChatsAtom`, `compactingSubChatsAtom`, `planEverGeneratedAtomFamily`, `localReviewCompletedAtomFamily`, `prCreatingAtomFamily`) plus tRPC queries (`chats.getPrStatus`, `chats.get`, `changes.getStatus`) and feeds them into `computeWorkflowState`. Re-evaluation is automatic via React selectors; `agentFinishedTickAtomFamily(chatId)` provides a cheap nudge after each AI run.
- **`useWorkflowActions(chatId, subChatId) → { dispatch, pushDialog }`** — central dispatcher for every milestone action (`expandPlan`, `mergeBase`, `pushBranch`, `reviewLocal`, `reviewPr`, `createPr`, `openPr`).

Both hooks are mounted in two places: `DetailsRail` (drives the Status widget) and `ChatViewInner` (drives the notch). tRPC dedupes the queries by key, so the cost is mostly redundant `useEffect` runs — idempotent and acceptable.

### `pendingXxxMessageAtom` pattern — cross-component AI prompts

Several actions need the active sub-chat's `ChatViewInner` to send a message that was authored elsewhere (the diff panel, the rail, the PR widget). The convention is to write the prompt into a jotai atom; `ChatViewInner` has a `useEffect` that consumes the atom and calls `sendMessage`.

Atoms in this family (all in `agents/atoms/index.ts`):

- `pendingPrMessageAtom` — "Create a pull request…" prompt
- `pendingReviewMessageAtom` — `/review` prompt with PR context
- `pendingConflictResolutionMessageAtom` — merge-conflict resolution prompt
- `pendingMergeBaseMessageAtom` — "Merge latest from {baseBranch}…" prompt
- `pendingBuildPlanSubChatIdAtom` — triggers `handleApprovePlan` for the matching sub-chat (no message — just an ID flag)
- `pendingImplementPlan` (local React state, not jotai) — set immediately after plan approval

Each atom has a sibling `useEffect` in `ChatViewInner` that:
1. Checks `pendingMessage?.subChatId === subChatId && !isStreaming`
2. **Clears the atom first** (`setPendingMessage(null)`) to prevent double-sending
3. Calls `sendMessage({ role: "user", parts: [{ type: "text", text: ... }] })`

When adding a new cross-component prompt: declare the atom alongside the existing trio, write the consumer effect in `ChatViewInner` next to `pendingPrMessage`/`pendingReviewMessage`, and route writes through `useWorkflowActions.dispatch`.

### Critical invariants — do not break

- **Model-switch ordering.** When triggering an AI review from outside the chat tree, `applyModeDefaultModel(subChatId, "review")` MUST run synchronously **before** any `await` — the transport reads `subChatModelIdAtomFamily(subChatId)` at send-time, and yielding the event loop before setting the model means the chat input flips visibly *after* the review prompt appears (or worse, the prompt is sent with the previous model). Three call sites enforce this: `diff-panel.tsx:handleReview`, `active-chat.tsx:handleReview`, `use-workflow-state.ts:dispatch("reviewPr")`. Verify the order if you touch any of them.
- **`computeWorkflowState` stays pure.** No imports from `react`, `jotai`, `@trpc/*`, or anything in `apps/desktop/src/renderer/features/`. The hook does the I/O; the function does the math.
- **`next` is the single source of truth for the primary action.** Don't read individual milestones to decide what button to show — read `workflow.next.actionKind`. The notch and rail must agree, which they do because both read `workflow.next`.
- **"View plan" opens the dock panel.** `useWorkflowActions.dispatch("expandPlan")` is the single workflow entry point; tool-row buttons in `agent-plan-tool.tsx` / `agent-plan-file-tool.tsx` call `addOrFocus` directly because they have a more specific `planPath` (virtual `codex-plan://...` URI / Write-tool file path) than the sub-chat's persisted `currentPlanPath`.
- **`baseBranchBehind` requires a fresh fetch.** `getPrStatus` runs a quiet `git fetch origin <baseBranch>` (8 s timeout, errors swallowed) before the `git rev-list --count HEAD..origin/<baseBranch>`. Without the fetch, `origin/<baseBranch>` is whatever was last fetched and the count silently under-reports.
- **`hasRemote` is distinct from `hasUpstream`.** `hasRemote = false` means *no* remote is configured at all (Code shows "Changes ready (no remote)", PR is permanently idle). `hasUpstream = false` with `hasRemote = true` means a remote exists but the local branch isn't tracking it (Code goes amber → "Push branch to origin"). The Status widget treats these as different states; don't conflate them.
- **`prCreating` self-clears on failure.** Three effects in `useWorkflowState` clear the optimistic spinner: when a PR shows up in `getPrStatus`, when `hasRemote === false`, and 10 s after the AI stream ends without a PR appearing. Adding a new "create PR" entry point should NOT bypass `prCreatingAtomFamily` — the spinner is the only signal the user has that the action is in flight.

### Per-subChat persisted state

New atom families in `details-sidebar/atoms/index.ts` track milestone state per-subChat across reloads:

- `localReviewCompletedAtomFamily(subChatId)` — Review pill turns green after the user opens the diff sidebar via Review action. Persisted (`overview:localReviewCompleted`).
- `planEverGeneratedAtomFamily(subChatId)` — Plan pill turns green once the user has approved a plan in this sub-chat (set when `mode` transitions plan → agent). Persisted (`overview:planEverGenerated`).
- `prCreatingAtomFamily(subChatId)` — optimistic PR-creation spinner. **In-memory only** (resets on reload by design — recovery is via the next `getPrStatus` poll).

Backend changes that feed this:

- `GitChangesStatus.hasRemote: boolean` (in `shared/changes-types.ts`, populated by `main/lib/git/status.ts`).
- `getPrStatus` returns `baseBranchBehind: number` (in `main/lib/trpc/routers/chats.ts`) — runs the quiet fetch + `rev-list`.

## Layered architecture for the chat orchestrator

`active-chat.tsx` is being incrementally extracted into three dependency-ordered layers under `src/renderer/features/agents/`. The rule is: each layer can only depend on layers above it. Adding a `react`/`jotai`/`@trpc/*`/`features/*` import to a `machines/` file is a regression — that's the seam the test battery relies on.

```
machines/    ← PURE. Decision logic only. No React, no jotai, no tRPC.
services/    ← Side-effectful, but accept injected deps. No React imports.
components/  ← Thin React. UI only. Read atoms, dispatch via hooks.
hooks/       ← React glue. Composes services for components.
```

### `machines/` (already landed)

Pure TypeScript discriminated-union state machines. Mirror the shape of [workflow-state.ts](src/renderer/features/agents/utils/workflow-state.ts).

- [chat-mode-machine.ts](src/renderer/features/agents/machines/chat-mode-machine.ts) — `(state, event) → state` reducer for the chat mode + activity (idle / sending / streaming / errored). Encodes:
  - **PR #36 invariant**: mode toggles are rejected while `activity !== "idle"` so the caller can't observe a half-applied state.
  - **PR #51 invariant**: `HYDRATE` events carry a `hydrationVersion`; events with a stale version are ignored, so a late DB refetch can't clobber a `FORCE_MODE` flip.
  - **PR #38 hint**: every mode change sets a one-shot `mustApplyDefaults: true` so the caller knows to invoke `applyModeDefaultModel` synchronously.
- [plan-approval-machine.ts](src/renderer/features/agents/machines/plan-approval-machine.ts) — FSM for `handleApprovePlan`: `idle → starting → mode-switched → model-applied → ready-to-send → sent`. The same-provider branch jumps straight from `mode-switched` to `ready-to-send`; the cross-provider branch detours through `model-applied → PLAN_CONTENT_RESOLVED → ready-to-send`. Replaces the module-scope `planApproveInFlight` Set with `isInFlight(state)`.
- [transport-lifecycle.ts](src/renderer/features/agents/machines/transport-lifecycle.ts) — pure decision functions:
  - `decideTransportAction(input)` mirrors the imperative branches of `getOrCreateChat` (no-existing → CREATE; remote → KEEP; stale + idle → RECREATE; provider matches → KEEP; cross-provider with messages → KEEP; cross-provider empty → RECREATE).
  - `decidePlanApprovalCrossProviderRecreate({ previousProvider, newProvider, newIsRemote })` is the cross-provider branch the orchestrator follows after plan approval.

### `services/` (landed — 4 modules)

Side-effectful orchestrators that compose the machines with injected deps so each can be unit-tested without React, jotai, or tRPC. The seam is the `*Deps` interface — the renderer passes the real atom-reads / mutations / transport constructors, and the L2 test passes `vi.fn()` mocks.

- [plan-approval-service.ts](src/renderer/features/agents/services/plan-approval-service.ts) — `approvePlan(subChatId, deps)` runs the full plan→agent flow. Encodes invariants from PR #36 (sync model-switch before await), #38 (per-mode default propagation), #40 (snapshot `previousProvider` before any writes), #44 (KEEP transport for same-provider), #45 (await `persistMode({ exitPlan: true })` before deferred send), #51 (single-flight per subChatId), #52 (cross-provider RECREATE with plan attached). Returns `{ ok, transportAction, finalState, reason? }`.
- [mode-switch-service.ts](src/renderer/features/agents/services/mode-switch-service.ts) — `toggleMode` / `forceMode` / `hydrateMode` plus `noteSendRequested` / `noteStreamStarted` / etc. Encodes the mid-stream toggle gate (FSM rule), the synchronous-before-await ordering (PR #36), and the `hydrationVersion` stale-refetch guard (PR #51). `forceMode` bypasses the activity gate and is used by `approvePlan` to flip `plan → agent` mid-stream.
- [chat-send-service.ts](src/renderer/features/agents/services/chat-send-service.ts) — `sendPendingMessage(mountSubChatId, pending, clearPending, deps)` collapses the six near-identical `pendingXxxMessageAtom` consumer effects into one function. Enforces clear-before-await (so a re-render can't double-fire) and the idle-only / subchat-scoped gates. `drainFirstPending` consumes the first matching atom from an array.
- [transport-factory.ts](src/renderer/features/agents/services/transport-factory.ts) — `getOrCreateChat(input, deps)` wraps the FSM in `transport-lifecycle.ts` with the cache + constructor injection. Replaces the `instanceof CodexChatTransport` checks scattered through `active-chat.tsx`. Returns `{ chat, action, provider }`.

**Layering invariant**: a service file MUST NOT import from `react`, `jotai`, `@trpc/*`, or anything in `features/agents/main/*`. The imports are limited to `machines/*` and stable shared types. The L2 tests assert this implicitly by running in node without any of those modules in scope.

**Where the renderer wires them in**: see [Phase 3 wiring contract](#phase-3-wiring-contract) below. The services are landed but `active-chat.tsx` still uses its imperative blocks pending Phase 3 component extraction. Wiring the services in is a one-line replacement of each block — see the `Wire-in checklist` per service in the file headers.

## Test battery

Six layers, each catching a different class of bug. Lower layers are cheaper, faster, and more deterministic — push regression tests as low as possible.

### When to add a test (and when to skip)

**Default rule**: every new feature ships with a test at the lowest layer that captures its essential behavior — _but only when a test makes sense_. The qualifier matters. A test that re-asserts what TypeScript already enforces, or that pins implementation details so tightly that any refactor breaks it, is worse than no test. Be honest about whether the test is providing real coverage.

Use this decision tree before you start writing:

| Feature shape | Layer | Test? |
|---|---|---|
| Pure decision / state machine / data transform | L1 | **Yes** — write the test first if you can. These are cheap and stay green forever. |
| Service / orchestrator with side effects | L2 | **Yes** — tag any regression invariants with the PR number that introduced them. |
| Per-subChatId or per-chatId hook that glues atoms | L3.5 | **Yes** — the isolation guarantee is the whole point of the hook. |
| Component that owns business logic (event handlers, derivations) | L3 | **Yes** — render + simulate + assert on output. |
| Multi-step user flow that crosses 3+ files | L4 | **Yes** if the flow has historically been bug-prone (see the bug-cluster matrix). |
| Component that's pure presentation (CSS, layout, mostly markup) | — | **Skip** — RTL tests on these are mostly snapshots, which decay into churn. |
| One-line config / env / dev-experience tweak | — | **Skip** unless the wiring is non-obvious (like the `update-config` skill workflow's "pipe-test the raw command"). |
| Bug fix | L1 / L2 / L4 | **Always** — reproduce the bug in a failing test FIRST, then fix. Tag the test name with the PR number and add a row to the bug-cluster matrix. |
| Refactor that doesn't change behavior | — | The existing tests should keep passing. If they don't, the refactor changed behavior — write a test for the new behavior or revert. |

**The cost-of-no-test argument**: skipping a test is fine when (a) the existing battery already exercises the code path, or (b) the feature is small enough that the next code review catches mistakes more cheaply than a test would. It is _not_ fine when the feature touches a recurring bug surface (mode/plan/transport/session), introduces a new cross-component contract, or extends a deps interface — those areas have a track record of breaking silently.

**When tests don't make sense, say so in the commit body.** A one-line "no test — pure CSS tweak" is enough; it tells the next reader you considered it.

### Layers

| Layer | Tooling | Lives in | When to use |
|---|---|---|---|
| **L1: Pure** | vitest (node env) | `machines/`, `utils/` | Decision logic, FSM transitions, idempotence — no React, no DOM, no IPC |
| **L2: Service** | vitest + `vi.mock` | `services/*.test.ts` (landed — 4 files, 68 tests) | Sequencing, race guards, cross-provider switch — mock atom-reads + tRPC + transport; drive the real service |
| **L3: Component** | vitest (jsdom) + RTL | `components/` (Phase 3 — extraction in progress) | Render correctness, event handlers, prop wiring — no business logic |
| **L3.5: Hook** | vitest (jsdom) + RTL `renderHook` + jotai `<Provider>` | `hooks/*.test.tsx` (landed — `use-chat-view-state.test.tsx` with 7 tests) | Atom-binding semantics, per-id isolation, default-fallback behavior — no service deps, no tRPC. Sits between L3 (component DOM) and L2 (service mocks) for hooks that just glue atoms together. |
| **L4: Integration** | vitest (node env) + real `appStore` + `applyModeDefaultModel` | `__tests__/integration/*.test.ts` (landed — 5 files, 19 tests) | Multi-step flows (plan → approve → agent) — workflow assertions, not LLM output |
| **L5: E2E** | Playwright + electron | `e2e/` (Phase 5, optional) | Smoke happy paths in real Electron |

### Conventions

- **Per-file jsdom**: tests that need a DOM put `// @vitest-environment jsdom` as the first line. The default env stays `node` so pure tests run fast.
- **RTL cleanup**: jsdom test files must `import { cleanup } from "@testing-library/react"` and call it in `afterEach(cleanup)`. Without it, prior renders leak into the next test's body. (Auto-cleanup isn't wired globally because that would force jsdom on every file.)
- **Isolated jotai store per test**: use `renderWithProviders(<Component />)` from `test-utils/`. It mounts a `<JotaiProvider store={createTestStore()} />` so atoms don't leak across tests. Pass `{ store }` to seed the store.
- **Mock IPC, not real Electron**: tests must never touch `window.desktopApi` or `electron`. Use `vi.mock("../../../lib/window-storage", ...)` (see `model-switching.test.ts` for the shape) and `createMockTrpc()` for the tRPC client.
- **Coverage**: pure modules (`machines/`, `utils/`, `lib/model-switching.ts`, etc.) MUST be added to the `coverage.include` array in `vitest.config.ts` so regressions show up in the report.
- **Tag regressions to PRs**: when writing a test that guards against a real bug, put the PR number in the `describe` or `test` name (e.g., `"PR #51 regression"`). This makes the audit trail searchable.

### `test-utils/` helpers

| Helper | Purpose |
|---|---|
| `renderWithProviders(ui, { store? })` | RTL `render` wrapped in `<JotaiProvider>` with a fresh isolated store (or one you pass). Returns the standard RenderResult plus `store`. |
| `createTestStore()` | Fresh `createStore()` from jotai. Use when a test needs to seed atoms before render or assert atom state after. |
| `createMockTransport({ chatId, subChatId, provider, cwd? })` | `MockChatTransport` with a `vi.fn()` `sendMessages` and `sendCount` / `lastSendArgs` for assertion. Use in service + integration tests. |
| `createMockTrpc()` | Typed tRPC mock — `claude.chat.subscribe`, `codex.chat.subscribe`, `chats.updateSubChatMode.mutate`, `chats.createSubChat.mutate`, `files.writePastedText.mutate`. Extend as service tests need more procedures. |

## Refactor playbook for active-chat.tsx

`active-chat.tsx` is ~8.7k LOC. It owns ~28 distinct concerns and was edited in 7 of the last 50 fix commits — the recurring bug clusters are: cross-provider state pollution (#52, #44, #40, #36), plan↔agent mode racing (#51, #45, #38), session/transport lifecycle (#45, #44, #40, #7), atom↔local-state desync (#52, #51, #32), and timing/await ordering (#36, #41, #40).

**Before adding code to `active-chat.tsx`, ask**:
1. Is this a *decision* (given X, do Y)? → put it in `machines/` as a pure function and write an **L1** test.
2. Is this an *async sequence* with side effects (mutate DB, recreate transport)? → put it in `services/` (Phase 2) with injected deps; write an **L2** test that mocks the deps.
3. Is this *render*? → put it in `components/` (Phase 3) and write an **L3** component test.
4. Is this *atom/tRPC glue* (hook composing per-id state)? → put it in `hooks/` with an **L3.5** test (`renderHook` + jotai `<Provider>`) and let `active-chat.tsx` just call the hook.
5. Is this a multi-step user flow that crosses 3+ files (especially in the mode/plan/transport bug cluster)? → add an **L4** integration test under `__tests__/integration/`.
6. None of the above? Re-examine — it probably is one of them.

**Then ask**: does the test I'm about to write actually catch a regression class, or is it pinning implementation details? If it's the latter, skip it and note _"no test — implementation detail"_ in the commit body. The "only if it makes sense" qualifier from the [Test battery → When to add a test](#when-to-add-a-test-and-when-to-skip) decision tree applies here too.

**Extraction order** (low → high blast radius):
1. **Phase 0 — Test infra** (✅ landed): RTL + jsdom + `test-utils/`.
2. **Phase 1 — Pure machines** (✅ landed): `machines/{chat-mode,plan-approval,transport-lifecycle}.ts`.
3. **Phase 2 — Services** (✅ landed): `services/{plan-approval,mode-switch,chat-send,transport-factory}.ts` plus `*.test.ts` covering the bug-cluster invariants from PRs #36 / #38 / #40 / #44 / #45 / #51 / #52. Wiring into `active-chat.tsx` is a one-line replacement per concern (tracked under "Phase 3 wiring contract" below).
4. **Phase 3 — Components** (in progress): `streaming-status-indicator` → `chat-toolbar` → `plan-panel-inline` → `pending-files-strip` → `chat-input-bar` → `chat-message-list`. Each extraction: cut + paste + `<NewComponent {...props} />` + verify in `bun run dev` + write component test. **Verification step is mandatory** — agents without browser access should ship the cut as a draft PR for the user to verify, not merge blind.
5. **Phase 4 — Integration tests** (✅ landed for plan-approval/mode-switch flows; expand as services wire in): `__tests__/integration/flow-{plan-to-agent,cross-provider-approve,mode-toggle-mid-stream,stale-hydration,session-clear-after-approve}.test.ts`. Each `describe` block names the PR(s) it guards.
6. **Phase 5 — E2E** (optional): Playwright Electron for 2–3 smoke specs covering: open workspace → send Plan-mode message → approve → verify agent edits a file; cross-provider plan approval; mode toggle hotkey.

**Target**: `active-chat.tsx` ≤ 500 LOC of pure orchestration after Phase 3.

### Bug-cluster regression matrix

This table is the searchable audit trail. When a bug recurs, the failing test must already exist (or you add one tagged to the new PR). When a service or component is extracted, the matrix dictates which tests must remain green.

| PR | Bug class | What broke | Locked in by |
|---|---|---|---|
| #36 | Timing | `applyModeDefaultModel` ran AFTER `await`; chat input flipped late, wrong provider sometimes used | `services/plan-approval-service.test.ts` ("applyDefaultModel BEFORE await persistMode"), `services/mode-switch-service.test.ts` ("setMode and applyDefaultModel resolve before persistMode is awaited"), `__tests__/integration/flow-plan-to-agent.test.ts` |
| #38 | Defaults | Per-mode default model+thinking didn't reach all entry points (review, plan-approval, mode-toggle) | `services/plan-approval-service.test.ts` ("setMode receives mode='agent'"), `services/mode-switch-service.test.ts` ("applyDefaultModel always called"), `lib/model-switching.test.ts` |
| #40 | Stale closure | Mode captured at transport-construction time; post-approve sends still tagged `mode=plan` | `services/plan-approval-service.test.ts` ("readPreviousProvider runs BEFORE setMode and applyDefaultModel" + "readPreviousProvider invoked exactly once"), `__tests__/integration/flow-cross-provider-approve.test.ts` ("previousProvider captured BEFORE applyDefaultModel overwrites the override atom"), `lib/transport-mode-reading.test.ts` |
| #44 | Lifecycle | Same-provider plan approval recreated transport, orphaning in-flight TodoWrite/Task events | `services/plan-approval-service.test.ts` ("notifyProviderChange is NOT called for Claude→Claude/Codex→Codex"), `machines/transport-lifecycle.test.ts` ("cross-provider with messages → KEEP"), `services/transport-factory.test.ts` ("PR #44 — cross-provider WITH messages → KEEP") |
| #45 | Session | Approve didn't null sessionId; server resumed the plan-mode JSONL for the agent turn | `services/plan-approval-service.test.ts` ("persistMode called with mode: 'agent' and exitPlan: true" + "persistMode awaited BEFORE scheduleDeferredSend"), `__tests__/integration/flow-session-clear-after-approve.test.ts`, `main/lib/trpc/routers/claude-mode-change.test.ts` |
| #51 | Race | Stale DB refetch reset mode atom back to "plan" after a forced flip | `machines/chat-mode-machine.test.ts` ("HYDRATE with stale version is rejected"), `services/mode-switch-service.test.ts` ("hydrate with stale version is REJECTED — no setMode call"), `__tests__/integration/flow-stale-hydration.test.ts`, also single-flight: `services/plan-approval-service.test.ts` ("two parallel approvePlan calls") |
| #52 | Cross-provider | Codex GPT-5.5 plan → Claude Sonnet approval crashed the renderer with "Maximum update depth" | `services/plan-approval-service.test.ts` ("Claude→Codex: notifyProviderChange fires" + "Codex GPT-5.5 → Claude Sonnet"), `__tests__/integration/flow-cross-provider-approve.test.ts` (full scenario), `machines/plan-approval-machine.test.ts` ("Cross-provider Codex (gpt-5.5) → Claude (sonnet) approval — PR #52 specific scenario") |

When you fix a new bug:
1. Reproduce the bug in a failing L1 or L2 test FIRST.
2. Tag the test name with the PR number.
3. Add a row to this matrix in the same PR.
4. If the bug is in a service that already has integration coverage, also add an L4 case so the multi-step flow stays guarded.

### Maintenance plan

The recurring-bug pattern in this repo had two root causes: (a) a single 8.7k-LOC file with 18+ concerns intertwined, and (b) zero tests for the bug-prone paths until PR #33. The plan below codifies the seams that prevent both.

**1. Layering, enforced by directory + import discipline.**
- `machines/` → only standard lib + intra-`machines/` types.
- `services/` → only `machines/` + standard lib.
- `hooks/` → React + `services/` + `lib/`.
- `components/` → only React + `hooks/` + `components/`.
- Promotion to `machines/` or `services/` is preferred over adding logic to `active-chat.tsx`. New `useEffect` blocks in the orchestrator are a code-smell — most are a service waiting to be extracted.

**2. The "ask before adding to active-chat.tsx" gate** (5 questions earlier in this section) — apply it on every new PR that touches the file.

**3. Coverage gates.**
- Every file in `machines/` and `services/` MUST appear in `coverage.include` of `vitest.config.ts`. The list is checked manually until we add a CI gate.
- Pure modules target 100% line coverage; service modules target ≥ 90% with the gaps being defensive branches that the FSM already guards.

**4. PR-tagged regression tests.** Every test that guards a real bug includes `PR #NN` in its `describe` or `test` name. `git grep "PR #" apps/desktop/src/renderer/features/agents/{machines,services,__tests__}` lists the audit trail.

**5. Invariants are tests, not comments.** When a service file says "X must run before Y", there's a test asserting the call order via `vi.fn().mock.invocationCallOrder` or a sequenced `events.push(...)` log. Comments rot; tests fail.

**6. Service-level wire-in path.** Each service's file header carries the imperative-source line range it replaces in `active-chat.tsx`. When a Phase 3 component is extracted, the new component imports the service rather than reaching into `appStore`/`agentChatStore` directly — the renderer's only remaining job is wiring the deps.

**7. Browser verification is non-optional for Phase 3 cuts.** The CLAUDE.md note ("verify changes by running the app in the UI") applies double when extracting a component out of `active-chat.tsx`: closures into the parent `useState` / `useRef` / atom subscriptions are easy to miss and TypeScript won't catch them. Agents without `bun run dev` access should ship Phase 3 cuts as draft PRs annotated with the smoke-test steps, never as merged commits.

**8. New features ship with a test (or an honest justification for not).** Apply the decision tree under [Test battery → When to add a test](#when-to-add-a-test-and-when-to-skip) for every new feature, hook, service, or non-trivial component. The "only if it makes sense" qualifier matters — a brittle test that pins implementation details is worse than no test. When skipping, include a one-line rationale in the commit body (e.g. _"no test — pure CSS tweak"_, _"covered by existing L4 flow-plan-to-agent suite"_). The next reader needs to know you considered it.

**9. Cross-component scope check after extracting helpers.** Two runtime crashes this branch (`messageIdSignature is not defined`, `hydratedSubChatIdsRef is not defined`) came from the same class of mistake: lifting a helper or ref out of the surrounding component without verifying that all call sites are still in the same lexical scope. After any extraction, `git grep` for every reference to the lifted symbol and confirm each one is either in the new module's scope OR can reach it via import. TypeScript will NOT catch this — JS module resolution accepts unbound identifiers as possibly-injected runtime values, and our `ts:check` is too noisy to rely on for fresh signal.

### Phase 3 wiring contract

The four services are drop-in replacements for these `active-chat.tsx` blocks. Each row gives the imperative source range, the new service entry-point, and the deps to inject.

| Concern | active-chat.tsx lines | Service | Wire-in deps |
|---|---|---|---|
| Plan approval flow | `3604–3712` (incl. consumer effect) | `approvePlan(subChatId, deps)` | `readPreviousProvider`: read `agentChatStore.get(subChatId)?.transport instanceof CodexChatTransport` then fall back to `appStore.get(subChatProviderOverridesAtom)[subChatId]`. `setMode`: write atom + `useAgentSubChatStore.getState().updateSubChatMode`. `persistMode`: `updateSubChatModeMutation.mutateAsync({ subChatId, mode: "agent", exitPlan: true })` (skip when `subChatId.startsWith("temp-")`). `applyDefaultModel`: `applyModeDefaultModel(subChatId, "agent")` then derive `isRemote` from chat metadata. `notifyProviderChange`: `onProviderChange?.(subChatId, provider)`. `resolvePlanContent`: keep current `resolveApprovedPlanContent()`. `buildImplementPlanParts`: keep current. `isInFlight`/`markInFlight`/`releaseInFlight`: read/write `planApproveInFlight: Set<string>` (module-level, kept for now). `scheduleDeferredSend`: `setPendingImplementPlan({ subChatId, parts })`. |
| Mode toggle hotkey + slash command | scattered (Shift-Tab handler + `/plan` `/agent` slash) | `toggleMode(subChatId, to, deps)` | `readState`/`writeState`: keep an FSM state ref keyed on `subChatId`. `setMode` / `applyDefaultModel` / `persistMode`: same wiring as plan approval. `notifyProviderChange`: optional. `noteSendRequested` / `noteStreamStarted` / `noteStreamCompleted` / `noteStreamErrored` are called from the matching `useChat` callbacks. |
| `dbSubChats` hydration loop | `2529–2546` | `hydrateMode(subChatId, from, hydrationVersion, deps)` | Increment `hydrationVersion` per query refetch (use `dataUpdatedAt` from React Query as the version). |
| 6 pending-message effects | `2977–3064`, `3472–3521` | `sendPendingMessage(mountSubChatId, pending, clearPending, deps)` × 6 OR a single `drainFirstPending` over the array of `(pending, clearPending)` pairs | `sendMessage`: SDK `sendMessage`. `isStreaming`: `() => status === "streaming" \|\| status === "submitted"`. The renderer keeps the six atom subscriptions; the service just collapses the body. |
| `getOrCreateChat` | `7256–7489` | `getOrCreateChat(input, deps)` | `readExistingChat`: `agentChatStore.get`. `getExistingProvider`: `existing.transport instanceof CodexChatTransport ? "codex" : "claude-code"`. `isStaleRuntime`: existing `shouldRecreateStaleRuntimeChat`. `createChat`: build the right transport (IPC/Codex/Remote) + `new Chat<any>({ id, messages, transport, onError, onFinish })`. `storeChat`: `agentChatStore.set(subChatId, chat, chatId)`. `deleteExistingChat`: `agentChatStore.delete(subChatId)`. |

When wiring, **do not** add new branches in `active-chat.tsx` for cases the service already handles. If a code review notices a service-equivalent decision being re-implemented in the renderer, that's a regression in the layering — the fix is to extend the service's deps interface, not duplicate logic.

### Phase 3 component extraction guide

`active-chat.tsx` will be cut into the components below. Each cut is independently reviewable and the order is chosen so dependent components extract last. **Cut → paste → wire → verify in `bun run dev` → component test.** Don't merge a cut that hasn't been verified in the browser.

| # | Component | Status | Purpose | Source lines (approx) | Deps to thread through |
|---|---|---|---|---|---|
| 0a | `message-group` | ✅ landed | User-message-height measurement + `content-visibility: auto` perf wrapper | extracted | `children`, `isLastGroup` |
| 0b | `split-pane-inline-close` | ✅ landed | Close button for split-pane chats | extracted | `subChatId` |
| 0c | `scroll-to-bottom-button` | ✅ landed | Sticky scroll-to-bottom with isolated scroll listener | extracted | `containerRef`, `onScrollToBottom`, `isActive`, `isSplitPane`, `subChatId` |
| 1 | `streaming-status-indicator` | n/a — already lives inside `AgentSendButton` | The `AgentSendButton` component already owns the spinner/Stop/Regenerate UI; there is no separate inline status block in `active-chat.tsx` to extract. Closed. | — | — |
| 2 | `chat-toolbar` | ✅ landed | Title editor + workspace subtitle | extracted | `subChatId`, `subChatName`, `isMobile`, `isSubChatsSidebarOpen`, `isSplitPane`, `workspaceRepoName`, `workspaceBranch`, `onRenameSubChat` |
| 3 | `plan-panel-inline` | n/a — no inline plan widget renders in `active-chat.tsx`; the Plan UI lives in the right rail (DetailsRail) and as a dock panel, both already extracted. Closed. | — | — | — |
| 4 | `pending-files-strip` | n/a — lives inside the already-extracted `ChatInputArea` (chat-input-area.tsx). Closed. | — | — | — |
| 5 | `chat-input-bar` | ✅ already extracted as `chat-input-area.tsx` (pre-Phase 3). The `selectedModel` derivation invariant from PR #52 is already in place there. | n/a | n/a |
| 6 | `chat-message-list` | ✅ already extracted as `IsolatedMessagesSection` (`agents/main/isolated-messages-section.tsx`). `ChatViewInner` mounts it via the `MessageGroupWrapper={MessageGroup}` prop. | n/a | n/a |
| 7 | `diff-sidebar-renderer` | ✅ landed | Combined `DiffStateProvider` + `DiffSidebarRenderer` + internal `DiffSidebarContent` + `CommitFileItem` + context into one module: `components/diff-sidebar.tsx` (~900 LOC). | extracted | exported as `DiffSidebarRenderer`, `DiffStateProvider`, `useDiffState` |
| 8 | `empty-state` | n/a — there is no inline empty-state JSX block in `active-chat.tsx`; the empty-message handling lives in `IsolatedMessagesSection`. Closed. | — | — | — |
| 9 | `terminal-bottom-mount` | ✅ landed | Bottom-panel mount wrapping `TerminalBottomPanelContent` | extracted | `displayMode`, `worktreePath`, `isOpen`, `isMobileFullscreen`, `chatId`, `terminalScopeKey`, `toggleTerminalHotkey`, `onClose` |

**Phase 3 status**: every entry in this table is now resolved — landed, already extracted upstream, or closed because no inline block exists in `active-chat.tsx`. The remaining ~7.1k LOC of `active-chat.tsx` is orchestration (atom subscriptions, effects, `useChat` wiring, callbacks for the imported components). The next reduction lever is wiring the Phase 2 services in (replacing the imperative blocks the services already encode).

**Audit before extracting**: when picking a candidate, `git grep` for the symbol name across `src/renderer/features/agents/` first. The Phase 3 audit revealed that `CopyButton`, `PlayButton`, and `CollapsibleSteps` were already exported from `ui/message-action-buttons.tsx` and `main/assistant-message-item.tsx` respectively — the copies in `active-chat.tsx` were dead code. Removing them was the right move, not extracting yet another duplicate.

**Invariants to preserve when extracting** (these are the ones the bug cluster is built on):
- `applyModeDefaultModel(subChatId, mode)` runs **synchronously before any `await`** in every mode-switch entry point. Three renderer call sites today plus the `mode-switch-service.toggleMode`. The plan-approval service follows the same rule.
- `previousProvider` for plan approval is captured **before** any state writes — `applyModeDefaultModel` overwrites the provider override atom as a side effect, so by the time it returns, the snapshot is gone. `services/plan-approval-service.ts:readPreviousProvider` is the seam.
- The `pendingXxxMessageAtom` consumer effects clear the atom **before** the `await sendMessage(...)` so a re-render can't fire the same prompt twice. `services/chat-send-service.ts:sendPendingMessage` enforces this in one place.
- The `isActive` guard on the `pendingBuildPlanSubChatIdAtom` consumer effect prevents two `ChatViewInner` mounts (the legacy layout + the dockview chat panel) from both running `handleApprovePlan` for the same sub-chat — that race crashed the renderer in PR #51. The single-flight Set in the plan-approval service backs this up.
- **Selected model in the input bar must be derived (`useMemo`), not synced via `useState` + bidirectional `useEffect`** — that's the PR #52 oscillation. When extracting `chat-input-bar`, keep the `selectedModel` derivation pattern from the current `chat-input-area.tsx` fix.

## Debug Mode

When debugging runtime issues in the renderer or main process, use the structured debug logging system. This avoids asking the user to manually copy-paste console output.

**Start the server:**
```bash
bun packages/debug/src/server.ts &
```

**Instrument renderer code** (no import needed, fails silently):
```js
fetch('http://localhost:7799/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag:'TAG',msg:'MESSAGE',data:{},ts:Date.now()})}).catch(()=>{});
```

**Read logs:** Read `.debug/logs.ndjson` - each line is a JSON object with `tag`, `msg`, `data`, `ts`.

**Clear logs:** `curl -X DELETE http://localhost:7799/logs`

**Workflow:** Hypothesize → instrument → user reproduces → read logs → fix with evidence → verify → remove instrumentation.

See `packages/debug/INSTRUCTIONS.md` for the full protocol.
