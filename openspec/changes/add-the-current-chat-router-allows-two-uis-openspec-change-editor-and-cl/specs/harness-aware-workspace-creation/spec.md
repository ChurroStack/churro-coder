## ADDED Requirements

### Requirement: Existing `vibe-coding | spec-driven` card selector is preserved unchanged

The wizard's existing card selector for `vibe-coding | spec-driven` SHALL remain in place with its current component, labels, layout, and behavior. It continues to drive the choice between classic chat and the OpenSpec change editor. This change MUST NOT alter, hide, replace, or reposition that selector in the UI.

#### Scenario: Cards untouched
- **WHEN** the wizard renders after this change
- **THEN** the `vibe-coding | spec-driven` cards appear in the same location and with the same labels as before
- **AND** clicking a card produces the same downstream effect as before (classic chat vs openspec change editor)

### Requirement: New Workspace wizard exposes an Agent dropdown beside project / worktree / branch

The New Workspace wizard SHALL add a new dropdown labeled "Agent" placed as a sibling control at the same level as the project, worktree, and branch selectors (not nested inside, replacing, or visually grouped with the `vibe-coding | spec-driven` cards). Its options are:

- "Built-in" → `builtin`
- "Claude Code (CLI)" → `claude-cli`
- "Codex (CLI)" → `codex-cli`

The dropdown's value MUST be persisted across wizard sessions in a `lastSelectedAgentHarnessAtom`-style store, mirroring the existing `lastSelectedHarnessAtom` pattern. The default selection on first run SHALL be `builtin`.

#### Scenario: Dropdown placed next to project/worktree/branch
- **WHEN** the wizard renders
- **THEN** the Agent dropdown appears in the same row/section as the project, worktree, and branch selectors
- **AND** it is NOT visually nested inside or replacing the `vibe-coding | spec-driven` card selector

#### Scenario: Default selection
- **WHEN** the wizard opens for the first time on a fresh install
- **THEN** the Agent dropdown shows "Built-in"

#### Scenario: Selection persists across opens
- **WHEN** the user picks "Claude Code (CLI)" and submits the wizard, then reopens it later
- **THEN** the Agent dropdown defaults to "Claude Code (CLI)"

### Requirement: Card selector and Agent dropdown are independent inputs

The existing `vibe-coding | spec-driven` card selector and the new Agent dropdown SHALL be independent. Any combination of (card value, agent value) MUST be valid. Selecting any agent value MUST NOT change, disable, or hide any card option, and selecting any card value MUST NOT change, disable, or hide any agent dropdown option.

To prevent identifier collision in the renderer codebase between the existing `Harness` type (the cards) and the new agent-harness concept, the existing TypeScript type SHALL be renamed to `WizardTemplate`. This is a code-only rename with zero user-visible impact; card labels and behavior are unchanged.

#### Scenario: All combinations valid
- **WHEN** the user picks card "spec-driven" and agent "codex-cli" and submits
- **THEN** both values are passed to the create-workspace flow without one overriding the other
- **AND** the resulting first subChat has `openspecChangeId` set (per the cards' existing behavior) and `harness='codex-cli'`

#### Scenario: Builtin + vibe-coding still works
- **WHEN** the user picks card "vibe-coding" and agent "builtin" and submits
- **THEN** the resulting first subChat has `openspecChangeId IS NULL` and `harness='builtin'`, identical to today's behavior

#### Scenario: Internal rename compiles
- **WHEN** the codebase is type-checked after this change
- **THEN** there are no remaining references to `Harness` meaning the cards axis; all cards-axis references use `WizardTemplate`
- **AND** no user-facing string was changed by the rename

### Requirement: Selected agent harness flows into the first subChat

On wizard submission, the chosen `agentHarness` MUST be passed to the create-workspace mutation and persisted as the `harness` of the first subChat created for the new workspace.

#### Scenario: Agent flows to subChat row
- **WHEN** the wizard submits with `agentHarness='claude-cli'`
- **THEN** the first subChat row created for the new workspace has `harness='claude-cli'`

#### Scenario: Default agent if not set
- **WHEN** the wizard submits without an explicit Agent selection (legacy or test path)
- **THEN** the first subChat is created with `harness='builtin'`
