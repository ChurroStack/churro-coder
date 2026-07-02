## ADDED Requirements

### Requirement: Work item list does not include body
The system SHALL fetch the work item list without the issue body field so that the initial load is lightweight regardless of the number of assigned issues.

#### Scenario: List loads without body
- **WHEN** the work items list is fetched from GitHub
- **THEN** each `WorkItem` in the result SHALL have `body` set to `undefined` or `null`

#### Scenario: List still contains title, state, labels and metadata
- **WHEN** the work items list is fetched
- **THEN** each item SHALL include `number`, `title`, `state`, `url`, `repository`, `labels`, `createdAt`, `updatedAt`

### Requirement: On-demand issue body fetch
The system SHALL provide a `getDetail` procedure that fetches the body of a single issue by owner, repo, and number.

#### Scenario: Body fetched successfully
- **WHEN** `getDetail` is called with a valid `{ owner, repo, number }`
- **THEN** it SHALL return `{ body: string }` with the full issue description

#### Scenario: Issue has no body
- **WHEN** `getDetail` is called for an issue with an empty description
- **THEN** it SHALL return `{ body: "" }`

#### Scenario: Fetch fails (auth or network error)
- **WHEN** `getDetail` is called and the `gh` CLI returns an error
- **THEN** the procedure SHALL throw a tRPC error so the caller can surface it to the user

### Requirement: Per-issue body cache
The system SHALL cache the fetched body for each issue so that repeated selections within a session do not trigger additional `gh` CLI calls.

#### Scenario: First selection fetches from GitHub
- **WHEN** `getDetail` is called for an issue not yet in the body cache
- **THEN** it SHALL call `gh api` and store the result in the body cache

#### Scenario: Subsequent selection uses cache
- **WHEN** `getDetail` is called for an issue already in the body cache
- **THEN** it SHALL return the cached value without calling `gh api`

#### Scenario: Concurrent calls for the same issue coalesce
- **WHEN** `getDetail` is called for the same issue while a fetch is already in flight
- **THEN** both callers SHALL receive the same result from a single `gh api` call

### Requirement: Mention insertion resolves body before inserting
The system SHALL fetch the issue body via `getDetail` when the user selects a work item in the `@`-mention dropdown, and insert the resolved text into the chat input.

#### Scenario: User selects issue from mention dropdown
- **WHEN** the user picks a GitHub issue from the `@`-mention autocomplete list
- **THEN** the system SHALL call `getDetail`, await the result, and insert `#number: title (owner/repo)\n\nBODY` as plain text

#### Scenario: Body fetch is in progress
- **WHEN** `getDetail` is awaited after mention selection
- **THEN** the UI SHALL not freeze; the insertion SHALL complete once the fetch resolves

### Requirement: Panel insertion resolves body before inserting
The system SHALL fetch the issue body via `getDetail` when the user clicks an issue in the "My Work" panel, and insert the resolved text into the active chat input.

#### Scenario: User clicks issue in My Work panel
- **WHEN** the user clicks an issue row in the work items panel
- **THEN** the system SHALL call `getDetail`, await the result, and pass the serialized text (with body) to the `onInsert` callback
