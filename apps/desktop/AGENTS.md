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
- `src/renderer/features/agents/main/active-chat.tsx` - ChatView (still ~7k LOC, slated for extraction)
- `src/renderer/features/agents/atoms/index.ts` - Agent UI state atoms (incl. the `pendingXxxMessageAtom` family)
- `src/renderer/features/agents/stores/sub-chat-store.ts` - Per-workspace `openSubChatIds` / `activeSubChatId`
- `src/renderer/features/agents/lib/agents-actions.ts` - Hotkey-driven action handlers
- `src/renderer/features/agents/lib/agents-hotkeys-manager.ts` - keydown listener + shortcut → action map
- `src/renderer/features/agents/lib/model-switching.ts` - `applyModeDefaultModel(subChatId, mode)` — flips per-subChat model + thinking level

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
rm -rf ~/Library/Application\ Support/CS\ Coder\ Dev/  # Dev mode
rm -rf ~/Library/Application\ Support/CS\ Coder/        # Production

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

**Done (this branch — Status widget):**
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

**Known limitations / deferred:**
- `active-chat.tsx` is still ~7k LOC; the planned `<ChatBody />` extraction wasn't done.
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
- **"View plan" opens the dock panel, not the sidebar widget.** Both `details-rail.tsx` and `active-chat.tsx:handleNotchWorkflowAction` intercept `kind === "expandPlan"` and call `addOrFocus({ kind: "plan", ... })` BEFORE delegating to `dispatchWorkflowAction`. The dispatch has a fallback that opens the sidebar widget — kept for safety, but unreachable from the current callers. If you wire a third surface, follow the same intercept pattern.
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
