## ADDED Requirements

### Requirement: Single terminal component serves standalone and embedded use

The desktop SHALL expose one terminal React component and one server-side PTY session implementation, used both by the standalone "New Terminal" dock panel and by the chat panel when its `harness` is a CLI. Behavior parity MUST hold for: rendering, scrollback, resize, copy/paste, link handling, and stdin write API. Differences MUST be limited to the bootstrap input (cwd, command, env, initialInput, idleDetection).

#### Scenario: Same xterm options across uses
- **WHEN** a terminal renders inside a chat panel and another renders inside a standalone terminal panel
- **THEN** both instances are constructed with the same xterm.js options (font, theme, renderer, scrollback)
- **AND** both expose the same `terminal:write` mutation API to drive stdin

### Requirement: PTY session accepts a declarative `bootstrap` record

`terminal:createOrAttach` SHALL accept an optional `bootstrap` payload of shape `{ cwd?, command?, args?, env?, initialInput?, idleDetection? }`. When `command` is omitted, the session falls back to the user's default shell as today. When `command` is provided, the session spawns that binary with the supplied `args`/`env` merged onto the existing process env.

#### Scenario: Empty bootstrap launches default shell (regression guard)
- **WHEN** `terminal:createOrAttach` is called with no `bootstrap.command`
- **THEN** the PTY runs the user's default shell exactly as before this change

#### Scenario: Bootstrap with command spawns that binary
- **WHEN** `terminal:createOrAttach` is called with `bootstrap.command='claude'` and merged env
- **THEN** the PTY runs `claude` with the merged environment in `bootstrap.cwd`

#### Scenario: initialInput is written after spawn
- **WHEN** `bootstrap.initialInput='/init\n'` is provided
- **THEN** the PTY's stdin receives `/init\n` exactly once, after the process is up and the first PTY data has been observed (or after a 250ms ceiling, whichever comes first)

### Requirement: Programmatic `sendInput` is a first-class API

The renderer MUST be able to send arbitrary stdin data to a PTY pane without involving the xterm DOM keyboard handler. The existing `terminal:write` tRPC mutation IS this API. The chat input dispatcher and sidebar action buttons MUST use it to deliver composed slash-commands and prompt bodies.

#### Scenario: Chat input writes to PTY
- **WHEN** the chat input dispatcher invokes `terminal:write` with `{ paneId, data: '/model opus\nrefactor\n' }`
- **THEN** the PTY's stdin receives those bytes verbatim
- **AND** the xterm DOM was not focused or interacted with

### Requirement: Terminal is TUI-grade

The terminal component MUST correctly render output from full-screen TUIs such as `claude` and `codex`. Specifically:

- 256-color and truecolor escape sequences are honored.
- UTF-8 input and output are passed through without re-encoding.
- The alternate screen buffer is supported (TUIs can take over the viewport and restore it on exit).
- Cursor positioning, line clearing, and in-place rewrites work (progress bars, spinners).
- Mouse reporting modes used by the supported CLIs work for clickable elements.
- Resize events (`SIGWINCH`) are propagated to the PTY when the panel is resized.

#### Scenario: Alternate screen restored on TUI exit
- **WHEN** an embedded `claude` session enters then exits its alternate-screen TUI
- **THEN** the terminal returns to the original buffer with prior scrollback intact

#### Scenario: Resize propagates to PTY
- **WHEN** a chat panel hosting an embedded terminal is resized
- **THEN** the server PTY receives a resize call with the new (cols, rows)
- **AND** subsequent output reflects the new width

#### Scenario: Truecolor passes through
- **WHEN** the embedded CLI emits a truecolor SGR sequence
- **THEN** xterm.js renders the corresponding RGB color

### Requirement: Optional idle detection emits advisory events

When `bootstrap.idleDetection` is provided as `{ debounceMs: number, promptPatterns: string[] }`, the PTY session SHALL emit an `idle` event whenever no output has been observed for `debounceMs` AND the current cursor line ends with one of `promptPatterns`. The event MUST be advisory; sending input MUST always be allowed regardless of idle state.

#### Scenario: Idle event drives Send-button enable hint
- **WHEN** an embedded CLI has produced no output for the configured debounce and the cursor line matches a known prompt pattern
- **THEN** the session emits one `idle` event consumed by the chat panel
- **AND** the panel transitions Send from "advisory disabled" to "enabled"

#### Scenario: Idle false negative does not block send
- **WHEN** the heuristic does not consider the CLI idle but the user still presses Send
- **THEN** the input is written to the PTY anyway

### Requirement: Embedded terminal lifecycle is bound to its subChat

A chat-embedded terminal session MUST be addressable by `subChatId` (paired with a stable `paneId`). Closing the chat panel MUST detach the renderer view but keep the PTY alive (consistent with the standalone terminal's existing detach semantics) so reopening the chat reattaches to the same session. Deleting the subChat MUST kill the associated PTY.

#### Scenario: Reopen chat reattaches to running PTY
- **WHEN** the user closes a CLI-backed chat panel and reopens it for the same subChat
- **THEN** the embedded terminal reattaches to the existing PTY with scrollback preserved

#### Scenario: Deleting subChat kills the PTY
- **WHEN** a subChat with an embedded terminal session is deleted
- **THEN** the associated PTY is terminated and its session record is removed
