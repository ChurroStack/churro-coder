# Test battery

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md). Refactor playbook lives in [chat-orchestrator.md](chat-orchestrator.md).

Six layers, each catching a different class of bug. Lower layers are cheaper, faster, and more deterministic — push regression tests as low as possible.

## When to add a test (and when to skip)

**Default rule**: every new feature ships with a test at the lowest layer that captures its essential behavior — _but only when a test makes sense_. The qualifier matters. A test that re-asserts what TypeScript already enforces, or that pins implementation details so tightly that any refactor breaks it, is worse than no test. Be honest about whether the test is providing real coverage.

Use this decision tree before you start writing:

| Feature shape | Layer | Test? |
|---|---|---|
| Pure decision / state machine / data transform | L1 | **Yes** — write the test first if you can. These are cheap and stay green forever. |
| Service / orchestrator with side effects | L2 | **Yes** — tag any regression invariants with the PR number that introduced them. |
| Per-subChatId or per-chatId hook that glues atoms | L3.5 | **Yes** — the isolation guarantee is the whole point of the hook. |
| Component that owns business logic (event handlers, derivations) | L3 | **Yes** — render + simulate + assert on output. |
| Multi-step user flow that crosses 3+ files | L4 | **Yes** if the flow has historically been bug-prone (see the bug-cluster matrix in [chat-orchestrator.md](chat-orchestrator.md#bug-cluster-regression-matrix)). |
| Component that's pure presentation (CSS, layout, mostly markup) | — | **Skip** — RTL tests on these are mostly snapshots, which decay into churn. |
| One-line config / env / dev-experience tweak | — | **Skip** unless the wiring is non-obvious (like the `update-config` skill workflow's "pipe-test the raw command"). |
| Bug fix | L1 / L2 / L4 | **Always** — reproduce the bug in a failing test FIRST, then fix. Tag the test name with the PR number and add a row to the bug-cluster matrix. |
| Refactor that doesn't change behavior | — | The existing tests should keep passing. If they don't, the refactor changed behavior — write a test for the new behavior or revert. |

**The cost-of-no-test argument**: skipping a test is fine when (a) the existing battery already exercises the code path, or (b) the feature is small enough that the next code review catches mistakes more cheaply than a test would. It is _not_ fine when the feature touches a recurring bug surface (mode/plan/transport/session), introduces a new cross-component contract, or extends a deps interface — those areas have a track record of breaking silently.

**When tests don't make sense, say so in the commit body.** A one-line "no test — pure CSS tweak" is enough; it tells the next reader you considered it.

## Layers

| Layer | Tooling | Lives in | When to use |
|---|---|---|---|
| **L1: Pure** | vitest (node env) | `machines/`, `utils/` | Decision logic, FSM transitions, idempotence — no React, no DOM, no IPC |
| **L2: Service** | vitest + `vi.mock` | `services/*.test.ts` (landed — 4 files, 68 tests) | Sequencing, race guards, cross-provider switch — mock atom-reads + tRPC + transport; drive the real service |
| **L3: Component** | vitest (jsdom) + RTL | `components/` (Phase 3 — extraction in progress) | Render correctness, event handlers, prop wiring — no business logic |
| **L3.5: Hook** | vitest (jsdom) + RTL `renderHook` + jotai `<Provider>` | `hooks/*.test.tsx` (landed — `use-chat-view-state.test.tsx` with 7 tests) | Atom-binding semantics, per-id isolation, default-fallback behavior — no service deps, no tRPC. Sits between L3 (component DOM) and L2 (service mocks) for hooks that just glue atoms together. |
| **L4: Integration** | vitest (node env) + real `appStore` + `applyModeDefaultModel` | `__tests__/integration/*.test.ts` (landed — 5 files, 19 tests) | Multi-step flows (plan → approve → agent) — workflow assertions, not LLM output |
| **L5: E2E** | Playwright + electron | `e2e/` (Phase 5, optional) | Smoke happy paths in real Electron |

## Conventions

- **Per-file jsdom**: tests that need a DOM put `// @vitest-environment jsdom` as the first line. The default env stays `node` so pure tests run fast.
- **RTL cleanup**: jsdom test files must `import { cleanup } from "@testing-library/react"` and call it in `afterEach(cleanup)`. Without it, prior renders leak into the next test's body. (Auto-cleanup isn't wired globally because that would force jsdom on every file.)
- **Isolated jotai store per test**: use `renderWithProviders(<Component />)` from `test-utils/`. It mounts a `<JotaiProvider store={createTestStore()} />` so atoms don't leak across tests. Pass `{ store }` to seed the store.
- **Mock IPC, not real Electron**: tests must never touch `window.desktopApi` or `electron`. Use `vi.mock("../../../lib/window-storage", ...)` (see `model-switching.test.ts` for the shape) and `createMockTrpc()` for the tRPC client.
- **Coverage**: pure modules (`machines/`, `utils/`, `lib/model-switching.ts`, etc.) MUST be added to the `coverage.include` array in `vitest.config.ts` so regressions show up in the report.
- **Tag regressions to PRs**: when writing a test that guards against a real bug, put the PR number in the `describe` or `test` name (e.g., `"PR #51 regression"`). This makes the audit trail searchable.

## `test-utils/` helpers

| Helper | Purpose |
|---|---|
| `renderWithProviders(ui, { store? })` | RTL `render` wrapped in `<JotaiProvider>` with a fresh isolated store (or one you pass). Returns the standard RenderResult plus `store`. |
| `createTestStore()` | Fresh `createStore()` from jotai. Use when a test needs to seed atoms before render or assert atom state after. |
| `createMockTransport({ chatId, subChatId, provider, cwd? })` | `MockChatTransport` with a `vi.fn()` `sendMessages` and `sendCount` / `lastSendArgs` for assertion. Use in service + integration tests. |
| `createMockTrpc()` | Typed tRPC mock — `claude.chat.subscribe`, `codex.chat.subscribe`, `chats.updateSubChatMode.mutate`, `chats.createSubChat.mutate`, `files.writePastedText.mutate`. Extend as service tests need more procedures. |
