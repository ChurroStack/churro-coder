## 1. Monaco config — make readOnly dynamic

- [x] 1.1 In `apps/desktop/src/renderer/features/file-viewer/components/monaco-config.ts`, remove `readOnly: true` from `defaultEditorOptions` and export a `getEditorOptions(readOnly: boolean)` helper that merges the flag into the default options object

## 2. tRPC writeFile mutation

- [x] 2.1 Add a `writeFile` mutation to `apps/desktop/src/main/lib/trpc/routers/files.ts` that accepts `{ filePath: string; content: string }`, validates the path is absolute, and writes the content using `fs.writeFile` with `utf-8` encoding
- [x] 2.2 Wire the new procedure into the tRPC client types so the renderer can call `trpc.files.writeFile.useMutation()`

## 3. FilePanelEntity — add subChatId param

- [x] 3.1 Extend the `FilePanelEntity` type (in `file-panel.tsx` or its shared types file) with an optional `subChatId?: string` field
- [x] 3.2 Update all call sites that open file panels (Changes widget, file tree) to pass `subChatId` when available

## 4. CodeViewer — edit mode state and Monaco wiring

- [x] 4.1 Add `isEditMode` and `editContent` state to `CodeViewer` in `file-viewer-sidebar.tsx`; initialize `editContent` from the loaded `content` prop when entering edit mode
- [x] 4.2 Use `editorRef.current.updateOptions({ readOnly: !isEditMode })` inside a `useEffect` keyed on `isEditMode` to toggle Monaco's writable state
- [x] 4.3 Add an `onChange` handler to the Monaco `<Editor>` that updates `editContent` when `isEditMode` is true

## 5. CodeViewerHeader — edit mode controls

- [x] 5.1 Add an "Edit content" button to `CodeViewerHeader` (left of "Open in"), visible only when `!isEditMode`; pass an `onEnterEditMode` callback prop
- [x] 5.2 Replace "Edit content" with a "Save" button (shown only when `isEditMode`); wire `onSave` callback prop
- [x] 5.3 Add "Discard changes" button shown only when `isEditMode`; wire `onDiscard` callback prop
- [x] 5.4 Add "Undo" and "Redo" icon buttons shown only when `isEditMode`; on click call `editorRef.current.trigger('toolbar', 'undo', null)` and `'redo'` respectively

## 6. Save handler — write to disk, invalidate cache, and record change

- [x] 6.1 Implement the `handleSave` function in `CodeViewer`: call `trpc.files.writeFile.mutate({ filePath, content: editContent })`, then exit edit mode
- [x] 6.2 After a successful disk write, call `utils.files.readTextFile.invalidate({ filePath })` to immediately bust the 30-second stale cache so subsequent reads (e.g., markdown preview flip, other open panels for the same file) get fresh content; also update the local in-memory `content` state to `editContent` to avoid flicker while the re-fetch completes
- [x] 6.3 After a successful disk write, if `subChatId` is defined in the panel params, call `trpc.messages.append` with a synthetic assistant message: `{ id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'tool-Write', state: 'done', input: { file_path, content }, output: { content } }] }`

## 7. Discard handler — confirmation dialog

- [x] 7.1 Implement the `handleDiscard` function: show an `AlertDialog` (shadcn/ui) with "Are you sure you want to discard your changes?"; on confirm, reset `editContent` to the original pre-edit content and exit edit mode; on cancel, do nothing

## 8. Close guard and dirty indicator — dockview tab

- [x] 8.1 In `FilePanelWrapper` (or `file-panel.tsx`), pass the dockview `api` down to `CodeViewer`/`MarkdownViewer` via a prop or callback pair `{ onEnterEditMode, onExitEditMode }` that call `api.setClosable(false)`, `api.setTitle('• ' + filename)` on enter, and `api.setClosable(true)`, `api.setTitle(filename)` on exit
- [x] 8.2 Intercept the existing `onClose` handler in the file panel header: when `isEditMode` is true, show the same discard `AlertDialog` before calling `api.close()`; when `isEditMode` is false, call `api.close()` directly

## 9. localStorage draft persistence and recovery

- [x] 9.1 Create a `useFileDraft(filePath: string, originalContent: string)` hook in `apps/desktop/src/renderer/features/file-viewer/` that exposes `{ saveDraft(content: string): void; clearDraft(): void; loadDraft(): { content: string; originalHash: string; draftedAt: number } | null }`. The hook maintains the LRU index at `"file-edit-drafts-index"` (capped at 10 entries) and skips writes when the content exceeds 1MB.
- [x] 9.2 Compute the SHA1 hash of the original on-disk content when entering edit mode using `crypto.subtle.digest('SHA-1', new TextEncoder().encode(originalContent))` and store it in the draft alongside `content` and `draftedAt`.
- [x] 9.3 Call `saveDraft(editContent)` in the `onChange` handler (debounced 500ms). Call `clearDraft()` on save or discard.
- [x] 9.4 On `CodeViewer` mount, call `loadDraft()`. If a draft exists, automatically enter edit mode with `draft.content` (no user prompt). Compute the SHA1 of the current on-disk `content` and compare to `draft.originalHash`: if hashes match, restore silently; if hashes differ, also show an inline conflict banner inside the editor: *"This file was modified since your draft was saved ([draftedAt time]). Your draft is active — save to keep your version or discard to use the on-disk version."*

## 10. MarkdownViewer — edit mode parity

- [x] 10.1 Replicate the `isEditMode` / `editContent` state, `onChange` handler, and `updateOptions` wiring in the Monaco editor block inside `MarkdownViewer` (source view only)
- [x] 10.2 Add the same "Edit content" / "Save" / "Discard changes" / "Undo" / "Redo" controls to the `MarkdownViewer` header, visible only when the source view is active
- [x] 10.3 Wire the `useFileDraft` hook into `MarkdownViewer` the same way as `CodeViewer` (draft save on change, auto-restore on mount with conflict banner if needed)
- [x] 10.4 Hide and reset edit mode (exit without saving) when the user toggles from source view back to preview while in edit mode — show the discard confirmation dialog before switching if there are unsaved changes
- [x] 10.5 Wire `onEnterEditMode` / `onExitEditMode` callbacks to the dockview `api` in `MarkdownViewer` the same way as `CodeViewer`

## 11. Verification

- [x] 11.1 Run `cd apps/desktop && bun run build` (or `pnpm exec nx run desktop:build`) and confirm zero TypeScript errors
- [x] 11.2 Manually verify: open a code file → click "Edit content" → tab title gains `•` prefix → make a change → click "Save" → file content on disk is updated → tab title returns to normal
- [x] 11.3 Manually verify: enter edit mode → click "Discard changes" → confirm → content reverts and mode returns to read-only
- [x] 11.4 Manually verify: enter edit mode → try to close the tab (X on tab strip is disabled) → use in-panel close → dialog appears → cancel → panel stays open
- [x] 11.5 Manually verify: open a file from a chat's Changes widget → edit + save → a new entry appears in the Changes widget for that chat
- [x] 11.6 Manually verify: in `MarkdownViewer` source view, save a file then flip to preview — preview shows the new saved content immediately (not the 30-second stale cache)
- [x] 11.7 Manually verify: `MarkdownViewer` source view shows the same edit controls and behaves identically
- [x] 11.8 Manually verify: enter edit mode → make changes → quit the app → reopen → open the same file → editor auto-enters edit mode with draft content, no prompt required
- [x] 11.9 Manually verify: when a file was modified externally between sessions, the conflict banner appears inline inside the editor after auto-restore

## 12. Post-review fixes (review of mechanical-lagoon)

### 12.1 High-severity

- [x] 12.1.1 In `file-viewer-sidebar.tsx` and `markdown-viewer.tsx`, stop persisting a draft when the user has not actually changed content. Remove the immediate-persist effect that fires once on entering edit mode; in the debounced effect, early-return when `editContent === editBaseContent`. Acceptance: open a file, click "Edit content", close the panel without typing — `localStorage` has no `file-edit-draft:<path>` entry and reopening starts in read-only.
- [x] 12.1.2 Add unit tests for `use-file-draft.ts` covering: LRU eviction when an 11th draft is added (oldest evicted), `MAX_DRAFT_BYTES` rejection (1 MB + 1 byte content is not persisted), malformed JSON in `localStorage` returns `null` from `loadDraft`, and `clearDraft` removes both the key and the index entry. Place at `apps/desktop/src/renderer/features/file-viewer/use-file-draft.test.ts`.
- [x] 12.1.3 Add an RTL component test covering the enter-edit → type → save → exit-edit happy path on `CodeViewer`, using `createMockTrpc` from `test-utils/` and a stubbed `writeFile` mutation. Verify the synthetic `tool-Write` message is appended via the mock when `subChatId` is provided.

### 12.2 Medium-severity

- [x] 12.2.1 Wrap `writeFileMutation.mutateAsync` in `handleSave` (both `file-viewer-sidebar.tsx` and `markdown-viewer.tsx`) in a try/catch. On failure, surface a toast (use the existing toast helper) and keep the draft + edit mode intact so the user can retry. Do not clear the draft or invalidate caches on failure.
- [x] 12.2.2 Scope `writeFile` in `apps/desktop/src/main/lib/trpc/routers/files.ts` to the workspace/worktree root. Add an optional `projectPath: string` to the input schema; when present, call `validatePathSafe(input.filePath, input.projectPath)`. Update both `CodeViewer` and `MarkdownViewer` save handlers to pass `projectPath` to the mutation.
- [x] 12.2.3 Resolve the double-update of `subChatFilesAtom` in both save handlers. Pick one path: (a) remove the explicit `setSubChatFiles(...)` block and rely on the existing change-tracking hook to recompute after `messages.getLatest` invalidation, OR (b) remove the broad `getLatest/getBefore/getAfter` invalidation and keep the explicit atom write. Document the choice in a one-line comment.
- [x] 12.2.4 Refactor `useFileDraft.saveDraft` to be fully synchronous: move SHA-1 computation of `originalContent` to a single `useEffect` that writes to `originalHashRef` once per `originalContent` change; have `saveDraft` read the ref synchronously (early-return if the hash is not yet computed). Removes the rapid-keystroke race on `localStorage.setItem` and `updateIndex`.
- [x] 12.2.5 In the dock-api effect in both viewers, move `dockApi.setClosable(true)` and `dockApi.setTitle(fileName)` into an unconditional cleanup so the tab is always restored on unmount, regardless of whether the panel was unmounted while in edit mode.

### 12.3 Verification

- [x] 12.3.1 Run `cd apps/desktop && bun run test` and confirm the new `use-file-draft.test.ts` and `CodeViewer` RTL test pass.
- [x] 12.3.2 Run `bun run build` and confirm zero new TypeScript errors.
- [x] 12.3.3 Manually verify: click "Edit content" → close panel without typing → reopen file → editor is read-only (no auto-restore).
- [x] 12.3.4 Manually verify: trigger a write failure (e.g., point `projectPath` outside the workspace) → toast appears → edit mode is preserved → draft is intact.
