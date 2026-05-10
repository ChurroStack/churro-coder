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

## Gotchas

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
