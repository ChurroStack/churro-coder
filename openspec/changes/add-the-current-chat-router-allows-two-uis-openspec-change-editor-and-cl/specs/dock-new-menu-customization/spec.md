## ADDED Requirements

### Requirement: Dockview "New" menu enumerates all surface combinations

The dockview "New" menu SHALL list a fixed set of entries — one per startable surface combination — backed by a registry of `NewMenuEntry { kind, label, icon, defaultPinned }`. The initial entries are:

- `chat` — New Chat (built-in)
- `chat-claude-cli` — New Claude CLI Chat
- `chat-codex-cli` — New Codex CLI Chat
- `terminal` — New Terminal
- `openspec-change` — New OpenSpec Change

Selecting an entry MUST create the appropriate panel(s) with the right `harness` (and any other implied state) bootstrapped on the underlying subChat row.

#### Scenario: New Claude CLI Chat creates a CLI-backed subChat
- **WHEN** the user clicks "New Claude CLI Chat" in the dock new menu
- **THEN** a new subChat is created with `harness='claude-cli'` and `openspecChangeId=null`
- **AND** a chat panel is added to the dock and bootstraps the embedded `claude` terminal

#### Scenario: New Chat creates a built-in subChat
- **WHEN** the user clicks "New Chat" in the dock new menu
- **THEN** a new subChat is created with `harness='builtin'` and `openspecChangeId=null`
- **AND** a chat panel renders the classic message list

#### Scenario: New Terminal unchanged
- **WHEN** the user clicks "New Terminal"
- **THEN** a standalone terminal panel opens with no `bootstrap.command` (default shell), exactly as before this change

### Requirement: Settings control which entries are pinned to the toolbar

A settings key SHALL store the list of pinned entry kinds (`dock.newMenu.pinned: string[]`). Pinned entries MUST appear as direct toolbar icons; non-pinned entries MUST appear in an overflow dropdown invoked from a single chevron button. Defaults MUST come from each entry's `defaultPinned` flag.

#### Scenario: Pinned entry appears as toolbar icon
- **WHEN** `dock.newMenu.pinned` contains `chat-claude-cli`
- **THEN** the toolbar shows a Claude-CLI icon directly
- **AND** the same entry does NOT appear in the overflow dropdown

#### Scenario: Non-pinned entry appears in dropdown
- **WHEN** `dock.newMenu.pinned` does not contain `openspec-change`
- **THEN** the New OpenSpec Change entry is reachable only from the overflow dropdown

#### Scenario: User toggles pin from settings
- **WHEN** the user enables pinning for `chat-codex-cli` in settings
- **THEN** the toolbar updates immediately to show the Codex CLI icon
- **AND** `dock.newMenu.pinned` persists the change
