# user-edit-change-tracking Specification

## Purpose
TBD - created by archiving change add-currently-when-opening-a-file-markdown-or-raw-code-the-monaco-editor. Update Purpose after archive.
## Requirements
### Requirement: User file saves are recorded in the subChat change stream
When a user saves edited content from the file viewer and the panel was opened with a `subChatId`, the system SHALL append a synthetic assistant message containing a `tool-Write` part to that subChat's message stream. The entry SHALL appear in the Changes widget identically to an AI-authored write.

#### Scenario: Save with known subChatId registers a tool-Write entry
- **WHEN** the user saves edited content from a file panel that has a `subChatId`
- **THEN** a synthetic assistant message is appended to that subChat's message stream
- **THEN** the message contains a `tool-Write` part with `state: 'done'`, `input.file_path` set to the saved file's absolute path, and `input.content` / `output.content` set to the saved content
- **THEN** the entry appears in the Changes widget for that subChat

#### Scenario: Save without subChatId does not attempt change tracking
- **WHEN** the user saves edited content from a file panel that has no `subChatId` (e.g., opened from the file tree without a chat context)
- **THEN** the file is written to disk successfully
- **THEN** no message is appended to any subChat's stream
- **THEN** no error is shown to the user

### Requirement: Synthetic write entry carries the full saved content
The `tool-Write` message part appended to the subChat SHALL contain the complete new file content so that the Changes widget can compute and display a diff between the previous and new versions.

#### Scenario: Changes widget shows a diff for user-saved file
- **WHEN** a synthetic `tool-Write` entry is appended after a user save
- **THEN** the Changes widget renders the file entry with a diff between the previous on-disk content and the saved content

### Requirement: File panels opened from a chat context carry the originating subChatId
When a file panel is opened from a context that has an active subChat (e.g., clicking a file link in the Changes widget or a chat message), the panel SHALL receive the originating `subChatId` as a parameter so that subsequent saves can be attributed to that chat.

#### Scenario: Opening a file from the Changes widget preserves subChatId
- **WHEN** the user opens a file by clicking it in the Changes widget of a specific subChat
- **THEN** the resulting file panel carries that subChat's `subChatId`
- **THEN** any save from that panel is recorded in the same subChat's change stream

#### Scenario: Opening a file from the file tree has no subChatId
- **WHEN** the user opens a file from the file tree sidebar without an active chat context
- **THEN** the resulting file panel has no `subChatId`
- **THEN** saves from that panel write to disk only, with no change-stream entry

