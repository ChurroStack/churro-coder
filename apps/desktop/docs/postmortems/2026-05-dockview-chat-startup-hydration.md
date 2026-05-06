# Dockview chat startup hydration showed "New Chat" tabs and blank active content

**Date:** 2026-05-06
**Severity:** Startup UI regression; persisted chats existed in SQLite but restored workspace tabs could show placeholder titles and the active chat body could be blank until the user clicked another tab.
**Files touched:**
- `apps/desktop/src/main/windows/main.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/preload/index.d.ts`
- `apps/desktop/src/renderer/features/dock/chat-panel-sync.tsx`
- `apps/desktop/src/renderer/features/dock/panels/chat-panel.tsx`
- `apps/desktop/src/renderer/features/dock/renamable-tab.tsx`
- `apps/desktop/src/renderer/lib/mock-api.ts`

---

## Symptom

On app launch, reopening the previously-selected workspace restored dockview chat panels, but every tab could display **"New Chat"** even though the database had real sub-chat names and message content.

The discriminator was user interaction: clicking a different dock tab made the other tabs update, and later fixes that corrected titles still left the active chat body visually blank. That meant the bug was not simply "the DB has the wrong title" or "lazy initialization never runs." The tab-click event changed dockview visibility/active state and caused the chat panel body to mount.

## What made this hard

There were two overlapping failures with the same visible trigger:

- Title hydration depended on `allSubChats`, but `allSubChats` was normally populated by `ChatViewInner`, and `ChatViewInner` only mounts when a `ChatPanel` body renders.
- Content hydration depended on `api.agents.getAgentChat.useQuery`, but the React Query/tRPC path could hold a non-chat payload for `chats.get` during startup.

Because clicking another tab changed both dockview visibility and query timing, several partial fixes appeared plausible but only solved one side.

## Root causes

### 1. Stale panel params were treated as authoritative

Dockview restores both panel params and panel title. `params.name` is the creation-time value from `addPanel({ params })`; it is not refreshed by `api.setTitle`. For restored panels it can still be `"New Chat"` while `api.title` has the real serialized title.

The old title-sync effect fell back to `params.name` when `allSubChats` was still empty, so it overwrote a good restored title with the stale placeholder.

Correct rule: for chat tabs, `allSubChats` is the only mutable title source. If the store has not hydrated the sub-chat yet, do not push a title.

### 2. Dockview restore did not reliably deliver initial visibility/active events

`ChatPanel` initialized local state from `api.isVisible` / `api.isActive` and then subscribed to dockview events. After `dock.fromJSON(...)`, the restored active panel could be logically active/visible without an event reaching the already-mounted React component. The panel body stayed unmounted, so `AgentsContent` and `ChatViewInner` never loaded until the user clicked another tab.

Correct rule: after dockview restore, re-read panel API state on layout changes and on the next animation frame. Also allow the store's active sub-chat to mount the matching panel body even if dockview's visibility flag is stale.

### 3. The startup data path could read a poisoned `chats.get` cache entry

Debug logs showed `chats.get` returning shapes like `{ success: true }` or unrelated procedure results in the cache. The likely lower-level cause is that the renderer has multiple tRPC IPC clients using the same Electron channel with independent request-id counters. When response IDs collide, a response can be delivered to the wrong pending request/cache slot.

Correct rule for this incident: critical startup hydration for restored chat panels should not depend solely on the renderer React Query cache. It now has a direct main-process DB snapshot path exposed as `desktopApi.getAgentChatSnapshot(chatId)`.

## Fix

### Direct snapshot path

`chat:get-agent-chat-snapshot` reads the parent chat, sub-chats, and project directly from SQLite in the main process and serializes dates to strings. The preload exposes it as `desktopApi.getAgentChatSnapshot(chatId)`.

This path is intentionally narrow. It is not a general replacement for tRPC; it is a startup recovery path for restored dockview chat panels when the renderer cache is not trustworthy yet.

### Workspace-level title hydration

`ChatPanelSync` now runs for the active workspace and calls `getAgentChatSnapshot`. It hydrates `useAgentSubChatStore.allSubChats` before reconciling restored chat panels, so tab titles can resolve without waiting for `ChatViewInner` to mount.

The redundant `getSubChatMetas` IPC route was removed; title hydration reuses the same full snapshot already needed for content fallback.

### Panel title and header sync

`ChatPanel` title sync now bails if the sub-chat is missing from `allSubChats`, avoiding the stale `params.name` overwrite.

`RenamableTab` also resolves chat tab title from the sub-chat store and avoids replacing a real restored title with a `"New Chat"` placeholder.

### Active content mount

`ChatPanel` now resyncs `api.isVisible` / `api.isActive` from dockview on layout change and next frame. It also mounts `AgentsContent` when the store says this sub-chat is active, which covers the startup case where dockview state is stale until a user click.

### Chat content fallback

`mock-api.ts` still calls `trpc.chats.get.useQuery` for the normal path, but it validates the payload before using it. If the payload is malformed or not a chat row, it uses `desktopApi.getAgentChatSnapshot(chatId)` so restored active chat content can render from SQLite.

## Triage heuristics for future dockview startup bugs

1. Start from the visible dockview element. For tab title bugs, trace `RenamableTab` → `api.title` → `ChatPanel` title sync → `allSubChats` hydration.
2. Treat `params` on restored panels as immutable creation-time state. Do not use `params.name` as the live title source.
3. Treat `api.isVisible` / `api.isActive` as values that may need a post-restore re-read. A missing dockview event can keep React state stale until the next user click.
4. If clicking a different tab fixes the UI, suspect a mount/visibility event dependency before suspecting the database.
5. When a React Query result shape is impossible for the procedure, log the full query key and payload shape before adding cache invalidations. Invalidating poisoned data usually just replays the wrong path.
6. Do not create one-off IPC APIs for partial slices unless the full snapshot path is insufficient. Multiple startup hydrators are easy to make inconsistent.

## Verification

- `cd apps/desktop && bun run test` → 595/595 tests passed.
- `cd apps/desktop && bun run build` → production build passed.

Manual checks for this incident:

- Reopen a workspace with existing renamed sub-chats. Titles should be correct immediately, without clicking another tab.
- The active restored sub-chat body should render messages immediately.
- Switch tabs and workspaces; titles and content should remain isolated per workspace.
- Create a new sub-chat; it should show `"New Chat"` until auto-rename/manual rename updates the store.
