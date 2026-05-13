# file-editor-edit-mode Specification

## Purpose
TBD - created by archiving change add-currently-when-opening-a-file-markdown-or-raw-code-the-monaco-editor. Update Purpose after archive.
## Requirements
### Requirement: Edit content button enters edit mode
The file viewer header SHALL display an "Edit content" button to the left of the "Open in" button when the viewer is in read-only mode. Clicking this button SHALL make the Monaco editor writable and replace the "Edit content" button with a "Save" button.

#### Scenario: Enter edit mode from read-only
- **WHEN** the user clicks "Edit content" in the file viewer header
- **THEN** the Monaco editor becomes writable (readOnly: false)
- **THEN** the "Edit content" button is replaced by a "Save" button
- **THEN** a "Discard changes" button appears in the header
- **THEN** "Undo" and "Redo" action buttons appear in the header

#### Scenario: Edit content button is absent in edit mode
- **WHEN** the viewer is in edit mode
- **THEN** no "Edit content" button is shown

### Requirement: Save button writes content to disk and exits edit mode
Clicking "Save" in edit mode SHALL write the current Monaco editor content to disk at the file's absolute path and return the viewer to read-only mode.

#### Scenario: Successful save
- **WHEN** the user clicks "Save" while in edit mode
- **THEN** the modified content is written to the file on disk
- **THEN** the Monaco editor returns to read-only (readOnly: true)
- **THEN** the "Save" button reverts to "Edit content"
- **THEN** the "Discard changes", "Undo", and "Redo" buttons are hidden

#### Scenario: Save with no changes
- **WHEN** the user clicks "Save" without having made any edits
- **THEN** the file is written to disk (idempotent, no error)
- **THEN** the viewer returns to read-only mode

### Requirement: Discard changes button restores original content with confirmation
The "Discard changes" button SHALL appear only in edit mode. Clicking it SHALL show a confirmation dialog. If the user confirms, the Monaco editor SHALL revert to the original (pre-edit) content and the viewer SHALL return to read-only mode.

#### Scenario: Discard confirmed
- **WHEN** the user clicks "Discard changes" and confirms in the dialog
- **THEN** the Monaco editor content reverts to the content that was loaded when edit mode was entered
- **THEN** the viewer returns to read-only mode
- **THEN** the "Discard changes", "Undo", and "Redo" buttons are hidden

#### Scenario: Discard cancelled
- **WHEN** the user clicks "Discard changes" and cancels in the dialog
- **THEN** the editor remains in edit mode with the user's changes intact

### Requirement: Undo and Redo buttons are available in edit mode
During edit mode, "Undo" and "Redo" buttons SHALL be shown in the header. Clicking them SHALL invoke Monaco's native undo/redo commands on the active editor instance.

#### Scenario: Undo an edit
- **WHEN** the user clicks "Undo" while in edit mode
- **THEN** the last edit operation is undone in the Monaco editor

#### Scenario: Redo an undone edit
- **WHEN** the user clicks "Redo" while in edit mode
- **THEN** the previously undone edit is reapplied in the Monaco editor

### Requirement: Markdown source view supports edit mode
When `MarkdownViewer` is showing the source view (Monaco editor visible after toggling "View source"), the same "Edit content", "Save", "Discard changes", "Undo", and "Redo" controls SHALL appear and behave identically to the `CodeViewer` edit mode.

#### Scenario: Edit markdown source
- **WHEN** the markdown viewer is in source view and the user clicks "Edit content"
- **THEN** the markdown Monaco editor becomes writable
- **THEN** all edit-mode controls appear in the header

#### Scenario: Edit mode controls hidden in markdown preview
- **WHEN** the markdown viewer is in preview mode (not source view)
- **THEN** no edit-mode controls are shown regardless of whether source-view edit mode was previously active

### Requirement: Close guard prevents accidental loss of unsaved changes
If the file viewer panel has unsaved changes (is in edit mode with any edits made), the dockview tab X and the in-panel close action SHALL NOT close the panel without a confirmation dialog. If the user confirms, the panel closes and changes are discarded. If the user cancels, the panel remains open and edit mode is preserved.

#### Scenario: Tab X disabled in edit mode
- **WHEN** the viewer is in edit mode with unsaved changes
- **THEN** the dockview tab's close button (X) is disabled (panel is marked non-closeable)
- **THEN** the user must use the in-panel close action to initiate closure

#### Scenario: In-panel close action with unsaved changes — confirmed
- **WHEN** the user activates the in-panel close action while in edit mode
- **THEN** a confirmation dialog appears asking to discard changes
- **WHEN** the user confirms
- **THEN** the panel closes

#### Scenario: In-panel close action with unsaved changes — cancelled
- **WHEN** the user activates the in-panel close action while in edit mode
- **THEN** a confirmation dialog appears asking to discard changes
- **WHEN** the user cancels
- **THEN** the panel remains open and edit mode is preserved

#### Scenario: Tab X and close action work normally in read-only mode
- **WHEN** the viewer is in read-only mode (not editing)
- **THEN** the tab X and in-panel close action close the panel immediately without a dialog

