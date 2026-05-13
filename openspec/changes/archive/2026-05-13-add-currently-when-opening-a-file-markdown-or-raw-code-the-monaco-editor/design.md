## Context

The file viewer panels (`CodeViewer` for code/text files and `MarkdownViewer` for `.md` files) render content using `@monaco-editor/react`. Both are hardcoded `readOnly: true` via `defaultEditorOptions` in `monaco-config.ts`. Users who want to make small edits must leave the app and use an external editor, even though the agent itself writes files directly via `tool-Write` tool call entries.

Key existing infrastructure:
- **No `writeFile` IPC/tRPC procedure exists** — the files router has `readFile`, `deleteFile`, `renameFile`, but no arbitrary write. A new mutation must be added.
- **Synthetic tool messages are possible** — `trpc.messages.append` accepts any `MessagePart[]`, so a synthetic `tool-Write` message can be injected into a subChat's stream to appear in the Changes widget.
- **Dockview close** — tab X calls `api.close()` and fires `onDidRemovePanel` after removal (too late to veto). Dockview provides `api.setClosable(false)` to disable the tab X.
- **`FilePanelEntity`** currently carries only `{ absolutePath: string }`; it must gain an optional `subChatId` so panels opened from a chat context can attribute saves to that chat.

## Goals / Non-Goals

**Goals:**
- Allow users to edit any code or markdown (source view) file in the Monaco editor via an "Edit content" button.
- Save edited content to disk and record the save as a synthetic `tool-Write` entry in the active subChat's change stream.
- Discard edits with a confirmation dialog, restoring original content.
- Show undo/redo action buttons during edit mode.
- Guard against accidental close (tab X and in-panel X action) when unsaved changes exist.
- Persist unsaved drafts to localStorage so edit sessions survive app crashes and force-quits; auto-restore on next open.
- Show a dirty indicator (`•`) on the dockview tab title while unsaved changes exist.

**Non-Goals:**
- Real-time collaborative or conflict-aware editing (no file-watch refresh during edit mode).
- Git staging or diff visualization beyond the existing Changes widget.
- Syntax error or lint feedback in the editor.
- Change tracking when `subChatId` is unknown (file opened from file tree with no active chat).

## Decisions

### 1. Draft in localStorage is the canonical edit-mode signal

**Decision:** `isEditMode: boolean` and `editContent: string | null` live in `useState` inside `CodeViewer` (and `MarkdownViewer`'s source view). `editContent` is mirrored to `localStorage` on every change (debounced 500ms). **The presence of a draft in localStorage is the indicator that the user was in edit mode.** On mount, if a draft exists for the file path, the editor automatically enters edit mode with the draft content — no explicit user prompt. On save or discard, the draft is cleared and the editor returns to read-only. If no draft exists on mount, the editor starts read-only.

The SHA1 check (Decision 6) only affects the UX message shown: a matching hash means silent auto-restore; a differing hash means an inline warning banner is shown inside the editor — "This file was modified since your draft. Your draft is active — save to keep your version or discard to use the on-disk version."

**Rationale:** A draft in localStorage means the user was actively editing — there is no ambiguity. Requiring an explicit "Restore?" prompt would be surprising (like an IDE asking whether to reopen your last session every time). Auto-restore is the expected behavior. The conflict banner (hash mismatch) is shown inline, non-blocking, so the user can assess and decide without being forced into a dialog on mount.

**Alternative considered:** IPC close-guard — intercept the Electron `BrowserWindow` `close` event in the main process, ask the renderer if dirty, then veto or allow. Rejected: it only prevents deliberate close, not crashes or OS-initiated kills. localStorage drafts handle all cases.

### 2. `readOnly` becomes a runtime option, not a config constant

**Decision:** Remove `readOnly: true` from `defaultEditorOptions` in `monaco-config.ts`. Instead, call `editorRef.current.updateOptions({ readOnly: !isEditMode })` when `isEditMode` changes. Export a `getEditorOptions(readOnly: boolean)` helper from `monaco-config.ts` for the initial mount.

**Rationale:** Monaco's `updateOptions()` toggles read-only without remounting the editor, preserving scroll position, cursor, and layout. Passing it as an `options` prop change would also work (monaco-react diffs options) but `updateOptions` is more explicit.

### 3. New `trpc.files.writeFile` mutation for disk writes

**Decision:** Add `writeFile({ filePath: string; content: string })` to the main-process files tRPC router (`apps/desktop/src/main/lib/trpc/routers/files.ts`). The handler uses `fs.writeFile(filePath, content, 'utf-8')` after validating that the resolved path is an absolute path (no traversal check beyond OS resolution, consistent with how `readTextFile` handles paths today).

**Rationale:** No existing write-to-arbitrary-path IPC exists. The `dialog:save-file` handler uses an Electron save dialog (wrong UX). `writePastedText` writes to a scoped session directory (not a worktree file). A new procedure is the cleanest path.

**Alternative considered:** Reuse `shell.openPath` or invoke the daemon's file-write capability via the existing IPC. Rejected: daemon involvement adds latency and complexity for a local file op.

### 4. Close guard via `api.setClosable(false)` + in-panel X confirmation

**Decision:**
- On entering edit mode, call `api.setClosable(false)` via the dockview panel `api` passed down to `CodeViewer`/`MarkdownViewer` through `FilePanelWrapper`.
- On exiting edit mode (save or discard), call `api.setClosable(true)`.
- The in-panel header's existing `onClose` callback is intercepted in edit mode to show a confirmation `AlertDialog` (shadcn/ui) before proceeding with `api.close()`.

**Rationale:** Dockview has no `onBeforeClose` / veto hook — `onDidRemovePanel` fires after the panel is already gone. Setting `api.setClosable(false)` is the only reliable way to prevent the tab X from immediately closing. The in-panel X is already a custom button whose behavior we control entirely.

**Alternative considered:** Override the `RenamableTab` component to intercept the close button click and show the dialog there. Rejected: it requires sharing dirty state across the tab and panel components (either via a global atom or context), which is more coupling for a simpler result.

### 5. Synthetic `tool-Write` via `trpc.messages.append`

**Decision:** On save, if `subChatId` is defined in the panel params, call `trpc.messages.append` with a synthetic assistant message containing a single `tool-Write` part with `state: 'done'`, `input.file_path`, `input.content`, and `output.content` equal to the saved content. Generate a unique message `id` with `crypto.randomUUID()`. Do NOT generate a `structuredPatch` — the Changes widget renders a diff lazily and handles absent patch data gracefully.

**Rationale:** `trpc.messages.append` already handles part spillage for large content (>256 KB). A `tool-Write` part is the exact type the Changes widget renders, so the saved file will appear as a user-authored write with a patch diff just like an AI write. No new rendering code needed.

**Alternative considered:** Write a dedicated "user-write" part type with its own renderer. Rejected: unnecessary new type and UI surface — the existing `tool-Write` renderer already covers this use case.

### 6. localStorage draft schema with SHA1 conflict detection

**Decision:** Each draft is stored under the key `"file-edit-draft:{absolutePath}"` with the following shape:

```json
{
  "content": "...edited content...",
  "originalHash": "sha1-of-content-when-edit-mode-was-entered",
  "draftedAt": 1715900000000
}
```

`originalHash` is computed via `crypto.subtle.digest('SHA-1', new TextEncoder().encode(originalContent))` at the moment the user clicks "Edit content". On mount, if a draft is found, the current on-disk content's SHA1 is computed and compared:

- **Hashes match** — file unchanged on disk → auto-enter edit mode silently with draft content. No prompt, no banner.
- **Hashes differ** — file was modified externally between sessions → auto-enter edit mode with draft content AND show an inline warning banner inside the editor: *"This file was modified since your draft was saved. Your draft is active — save to keep your version or discard to use the on-disk version."* The `draftedAt` timestamp is shown in the banner so the user can judge recency.

An LRU index is maintained at `"file-edit-drafts-index"` — a JSON array of `{ path, draftedAt }` ordered by recency, capped at **10 entries**. On every draft write, the index is updated and the oldest entry beyond the cap is evicted.

**Rationale:** SHA1 is a deterministic content identity check — immune to clock skew and filesystem timestamp precision differences across OSes. It's the same mechanism Git uses for blob identity. `crypto.subtle` is available in Electron's renderer without any extra dependencies. The 10-entry LRU cap keeps total localStorage usage well under 10MB for typical source files.

**Alternative considered:** Timestamp-only comparison. Rejected: filesystem `mtime` precision varies (1s on FAT32, 100ns on NTFS, 1s on HFS+) and clock skew makes it an unreliable conflict signal.

### 7. Dirty indicator on dockview tab via `api.setTitle()`

**Decision:** On entering edit mode, call `api.setTitle('• ' + filename)` where `filename` is the basename of `filePath`. On exiting edit mode (save or discard), call `api.setTitle(filename)` to remove the prefix. The `api` object (`IDockviewPanelApi`) is already available in `FilePanel` and is passed down to `CodeViewer`/`MarkdownViewer` via the same `onEnterEditMode` / `onExitEditMode` callbacks used for `setClosable`.

**Rationale:** `api.setTitle()` is the established pattern in this codebase — `TerminalPanel` and `ChatPanel` both call it in a `useEffect`. `RenamableTab` listens via `api.onDidTitleChange()` and syncs automatically. No new cross-component state needed.

### 8. React Query cache invalidation after save

**Decision:** After a successful `writeFile`, call `utils.files.readTextFile.invalidate({ filePath })` immediately. Do not rely solely on the `watchChanges` subscription for cache-busting. Additionally, update the in-memory `content` state in `CodeViewer` / `MarkdownViewer` to `editContent` so the editor doesn't flicker to stale content while the invalidated query re-fetches.

**Rationale:** `readTextFile` has `staleTime: 30000` (30 seconds). Without explicit invalidation, a save followed immediately by switching from markdown source to preview would re-render from the 30-second-old cache, showing the pre-edit content. `MarkdownViewer` calls `trpc.files.readTextFile.useQuery` directly (not through `useFileContent`), so the invalidation covers both code and markdown viewers. The `watchChanges` subscription may also trigger a refetch, but it's not guaranteed to fire synchronously — explicit invalidation is the reliable path.

**Edge case — multiple panels on same file:** If two file panels for the same path are open simultaneously (rare but possible), invalidating `{ filePath }` will cause both to refetch. This is the correct behavior — both should show the new content.

### 10. `subChatId` propagation via extended `FilePanelEntity` params

**Decision:** Extend `FilePanelEntity` with an optional `subChatId?: string` field. Callers that open file panels from a chat context (e.g., Changes widget click-through) pass the active subChatId. Callers without chat context (file tree, drag-and-drop) omit it. When absent, save completes silently without change-stream injection.

**Rationale:** Minimal-touch approach — only panels opened in a chat context participate in change tracking. No global "active subChat" selection needed.

## Risks / Trade-offs

- **Large file content in message parts** → Mitigation: The existing part-spill mechanism in `writeMessagesToTable` handles parts ≥ 256 KB by writing them to disk and storing a `_spill` envelope. No special handling needed.
- **Large file content in localStorage drafts** → localStorage is capped at ~5-10MB per origin in Chromium. A single 4MB file would exhaust the budget. Mitigation: the 10-entry LRU cap limits total draft storage; for files ≥ 1MB, skip draft persistence and log a console warning. A future follow-up can move large drafts to IndexedDB.
- **Concurrent AI write + user edit on same file** → Mitigation: No locking. If the AI writes a file while the user has unsaved edits, the in-editor content will diverge silently. The SHA1 check on restore will detect this divergence on next open. Scope note: in-session conflict detection is out of scope.
- **Path security on `writeFile`** → Mitigation: `writeFile` resolves to an absolute path (same validation as `readTextFile`). The tRPC router runs in the main process, already behind the contextBridge sandbox boundary. The risk surface is no wider than the existing `readTextFile` procedure.
- **Markdown source edit vs. preview inconsistency** → Resolved by Decision 8: explicit cache invalidation after save ensures that flipping to preview always renders fresh content. The in-memory `content` state is also updated immediately so there is no flicker between save and re-fetch completion.
- **`staleTime: 30000` on `readTextFile`** → Without invalidation this would serve 30-second-old content to any component that reads the file after a user save. Decision 8 (explicit `invalidate` after `writeFile`) eliminates this window entirely.
