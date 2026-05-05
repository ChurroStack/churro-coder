# Architecture (apps/desktop)

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

## Source tree

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
- `src/renderer/features/agents/main/active-chat.tsx` - ChatView (~7.1k LOC after the Phase 3 cuts — diff-sidebar module + chat-toolbar + terminal-bottom-mount + the three earlier component cuts removed ~1600 LOC of UI code from this file; Phase 2 services landed but not yet wired in — see [chat-orchestrator.md](chat-orchestrator.md))
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
- `src/renderer/features/agents/services/*.test.ts` - L2 service tests (68 tests) — see [testing.md](testing.md)
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
