## Why

The Monaco editor in the file viewer (code files and markdown source view) is hardcoded `readOnly: true`, forcing users to open an external editor just to make small edits. This breaks flow: the agent can write files directly in the UI via tool calls, but the user cannot. Allowing in-place edits with save tracking closes this gap and lets users participate in the same change workflow the AI uses.

## What Changes

- Add an **"Edit content"** button to the `CodeViewerHeader` (left of "Open in"), visible only in read-only mode.
- Clicking "Edit content" makes the Monaco editor writable and the button mutates to **"Save"**.
- A **"Discard changes"** button appears in the header (edit mode only); clicking it shows a confirmation dialog before reverting to the original content and re-entering read-only mode.
- **Undo / Redo** action buttons appear in the header during edit mode, driven by Monaco's built-in history.
- **"Save"** writes the new content to disk (via an IPC `fs.writeFile` call), then re-enters read-only mode.
- The save is recorded in the active subChat's change stream as a synthetic `tool-Write` entry so the change appears in the **Changes widget** alongside AI-authored writes.
- The **markdown editor** (`MarkdownViewer`) gets the same edit-mode controls when "View source" is active.
- If the user attempts to **close a dockview tab** (X on tab strip or the X action inside the panel) while unsaved changes exist, a confirmation dialog blocks the close until the user accepts or cancels.

## Capabilities

### New Capabilities

- `file-editor-edit-mode`: In-place editing of code and markdown-source views — edit/save/discard controls, Monaco writability toggle, undo/redo buttons, and close-guard when unsaved changes exist.
- `user-edit-change-tracking`: User-initiated file saves registered in the active subChat's change stream as synthetic `tool-Write` entries so they appear in the Changes widget.

### Modified Capabilities

*(none — no existing spec-level behavior changes)*

## Impact

- `apps/desktop/src/renderer/features/file-viewer/components/file-viewer-sidebar.tsx` — `CodeViewerHeader` and `CodeViewer` gain edit-mode state, new header buttons, and an `onChange` handler on the Monaco `<Editor>`.
- `apps/desktop/src/renderer/features/file-viewer/components/markdown-viewer.tsx` — `MarkdownViewer` gains the same edit controls when in source view mode.
- `apps/desktop/src/renderer/features/file-viewer/components/monaco-config.ts` — `readOnly` must become a runtime option rather than a constant in `defaultEditorOptions`.
- `apps/desktop/src/renderer/features/dock/panels/file-panel.tsx` — Intercept `api.close()` and show a guard dialog when unsaved changes are pending.
- `apps/desktop/src/preload/index.ts` / main-process IPC — A new `fs:writeFile` channel (or reuse of an existing write IPC) is needed for saving content from the renderer.
- `apps/desktop/src/renderer/features/agents/` — A utility to inject a synthetic `tool-Write` message part into a subChat's message stream for change-widget registration.
- No gateway or daemon changes required.
