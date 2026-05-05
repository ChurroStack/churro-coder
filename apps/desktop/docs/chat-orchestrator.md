# Chat orchestrator — layered architecture + refactor playbook

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md). Test conventions live in [testing.md](testing.md).

## Layered architecture

`active-chat.tsx` is being incrementally extracted into three dependency-ordered layers under `src/renderer/features/agents/`. The rule is: each layer can only depend on layers above it. Adding a `react`/`jotai`/`@trpc/*`/`features/*` import to a `machines/` file is a regression — that's the seam the test battery relies on.

```
machines/    ← PURE. Decision logic only. No React, no jotai, no tRPC.
services/    ← Side-effectful, but accept injected deps. No React imports.
components/  ← Thin React. UI only. Read atoms, dispatch via hooks.
hooks/       ← React glue. Composes services for components.
```

### `machines/` (already landed)

Pure TypeScript discriminated-union state machines. Mirror the shape of [workflow-state.ts](../src/renderer/features/agents/utils/workflow-state.ts).

- [chat-mode-machine.ts](../src/renderer/features/agents/machines/chat-mode-machine.ts) — `(state, event) → state` reducer for the chat mode + activity (idle / sending / streaming / errored). Encodes:
  - **PR #36 invariant**: mode toggles are rejected while `activity !== "idle"` so the caller can't observe a half-applied state.
  - **PR #51 invariant**: `HYDRATE` events carry a `hydrationVersion`; events with a stale version are ignored, so a late DB refetch can't clobber a `FORCE_MODE` flip.
  - **PR #38 hint**: every mode change sets a one-shot `mustApplyDefaults: true` so the caller knows to invoke `applyModeDefaultModel` synchronously.
- [plan-approval-machine.ts](../src/renderer/features/agents/machines/plan-approval-machine.ts) — FSM for `handleApprovePlan`: `idle → starting → mode-switched → model-applied → ready-to-send → sent`. The same-provider branch jumps straight from `mode-switched` to `ready-to-send`; the cross-provider branch detours through `model-applied → PLAN_CONTENT_RESOLVED → ready-to-send`. Replaces the module-scope `planApproveInFlight` Set with `isInFlight(state)`.
- [transport-lifecycle.ts](../src/renderer/features/agents/machines/transport-lifecycle.ts) — pure decision functions:
  - `decideTransportAction(input)` mirrors the imperative branches of `getOrCreateChat` (no-existing → CREATE; remote → KEEP; stale + idle → RECREATE; provider matches → KEEP; cross-provider with messages → KEEP; cross-provider empty → RECREATE).
  - `decidePlanApprovalCrossProviderRecreate({ previousProvider, newProvider, newIsRemote })` is the cross-provider branch the orchestrator follows after plan approval.

### `services/` (landed — 4 modules)

Side-effectful orchestrators that compose the machines with injected deps so each can be unit-tested without React, jotai, or tRPC. The seam is the `*Deps` interface — the renderer passes the real atom-reads / mutations / transport constructors, and the L2 test passes `vi.fn()` mocks.

- [plan-approval-service.ts](../src/renderer/features/agents/services/plan-approval-service.ts) — `approvePlan(subChatId, deps)` runs the full plan→agent flow. Encodes invariants from PR #36 (sync model-switch before await), #38 (per-mode default propagation), #40 (snapshot `previousProvider` before any writes), #44 (KEEP transport for same-provider), #45 (await `persistMode({ exitPlan: true })` before deferred send), #51 (single-flight per subChatId), #52 (cross-provider RECREATE with plan attached). Returns `{ ok, transportAction, finalState, reason? }`.
- [mode-switch-service.ts](../src/renderer/features/agents/services/mode-switch-service.ts) — `toggleMode` / `forceMode` / `hydrateMode` plus `noteSendRequested` / `noteStreamStarted` / etc. Encodes the mid-stream toggle gate (FSM rule), the synchronous-before-await ordering (PR #36), and the `hydrationVersion` stale-refetch guard (PR #51). `forceMode` bypasses the activity gate and is used by `approvePlan` to flip `plan → agent` mid-stream.
- [chat-send-service.ts](../src/renderer/features/agents/services/chat-send-service.ts) — `sendPendingMessage(mountSubChatId, pending, clearPending, deps)` collapses the six near-identical `pendingXxxMessageAtom` consumer effects into one function. Enforces clear-before-await (so a re-render can't double-fire) and the idle-only / subchat-scoped gates. `drainFirstPending` consumes the first matching atom from an array.
- [transport-factory.ts](../src/renderer/features/agents/services/transport-factory.ts) — `getOrCreateChat(input, deps)` wraps the FSM in `transport-lifecycle.ts` with the cache + constructor injection. Replaces the `instanceof CodexChatTransport` checks scattered through `active-chat.tsx`. Returns `{ chat, action, provider }`.

**Layering invariant**: a service file MUST NOT import from `react`, `jotai`, `@trpc/*`, or anything in `features/agents/main/*`. The imports are limited to `machines/*` and stable shared types. The L2 tests assert this implicitly by running in node without any of those modules in scope.

**Where the renderer wires them in**: see [Phase 3 wiring contract](#phase-3-wiring-contract) below. The services are landed but `active-chat.tsx` still uses its imperative blocks pending Phase 3 component extraction. Wiring the services in is a one-line replacement of each block — see the `Wire-in checklist` per service in the file headers.

## Refactor playbook for active-chat.tsx

`active-chat.tsx` is ~8.7k LOC. It owns ~28 distinct concerns and was edited in 7 of the last 50 fix commits — the recurring bug clusters are: cross-provider state pollution (#52, #44, #40, #36), plan↔agent mode racing (#51, #45, #38), session/transport lifecycle (#45, #44, #40, #7), atom↔local-state desync (#52, #51, #32), and timing/await ordering (#36, #41, #40).

**Before adding code to `active-chat.tsx`, ask**:
1. Is this a *decision* (given X, do Y)? → put it in `machines/` as a pure function and write an **L1** test.
2. Is this an *async sequence* with side effects (mutate DB, recreate transport)? → put it in `services/` (Phase 2) with injected deps; write an **L2** test that mocks the deps.
3. Is this *render*? → put it in `components/` (Phase 3) and write an **L3** component test.
4. Is this *atom/tRPC glue* (hook composing per-id state)? → put it in `hooks/` with an **L3.5** test (`renderHook` + jotai `<Provider>`) and let `active-chat.tsx` just call the hook.
5. Is this a multi-step user flow that crosses 3+ files (especially in the mode/plan/transport bug cluster)? → add an **L4** integration test under `__tests__/integration/`.
6. None of the above? Re-examine — it probably is one of them.

**Then ask**: does the test I'm about to write actually catch a regression class, or is it pinning implementation details? If it's the latter, skip it and note _"no test — implementation detail"_ in the commit body. The "only if it makes sense" qualifier from [testing.md → When to add a test](testing.md#when-to-add-a-test-and-when-to-skip) applies here too.

**Extraction order** (low → high blast radius):
1. **Phase 0 — Test infra** (✅ landed): RTL + jsdom + `test-utils/`.
2. **Phase 1 — Pure machines** (✅ landed): `machines/{chat-mode,plan-approval,transport-lifecycle}.ts`.
3. **Phase 2 — Services** (✅ landed): `services/{plan-approval,mode-switch,chat-send,transport-factory}.ts` plus `*.test.ts` covering the bug-cluster invariants from PRs #36 / #38 / #40 / #44 / #45 / #51 / #52. Wiring into `active-chat.tsx` is a one-line replacement per concern (tracked under "Phase 3 wiring contract" below).
4. **Phase 3 — Components** (in progress): `streaming-status-indicator` → `chat-toolbar` → `plan-panel-inline` → `pending-files-strip` → `chat-input-bar` → `chat-message-list`. Each extraction: cut + paste + `<NewComponent {...props} />` + verify in `bun run dev` + write component test. **Verification step is mandatory** — agents without browser access should ship the cut as a draft PR for the user to verify, not merge blind.
5. **Phase 4 — Integration tests** (✅ landed for plan-approval/mode-switch flows; expand as services wire in): `__tests__/integration/flow-{plan-to-agent,cross-provider-approve,mode-toggle-mid-stream,stale-hydration,session-clear-after-approve}.test.ts`. Each `describe` block names the PR(s) it guards.
6. **Phase 5 — E2E** (optional): Playwright Electron for 2–3 smoke specs covering: open workspace → send Plan-mode message → approve → verify agent edits a file; cross-provider plan approval; mode toggle hotkey.

**Target**: `active-chat.tsx` ≤ 500 LOC of pure orchestration after Phase 3.

### Bug-cluster regression matrix

This table is the searchable audit trail. When a bug recurs, the failing test must already exist (or you add one tagged to the new PR). When a service or component is extracted, the matrix dictates which tests must remain green.

| PR | Bug class | What broke | Locked in by |
|---|---|---|---|
| #36 | Timing | `applyModeDefaultModel` ran AFTER `await`; chat input flipped late, wrong provider sometimes used | `services/plan-approval-service.test.ts` ("applyDefaultModel BEFORE await persistMode"), `services/mode-switch-service.test.ts` ("setMode and applyDefaultModel resolve before persistMode is awaited"), `__tests__/integration/flow-plan-to-agent.test.ts` |
| #38 | Defaults | Per-mode default model+thinking didn't reach all entry points (review, plan-approval, mode-toggle) | `services/plan-approval-service.test.ts` ("setMode receives mode='agent'"), `services/mode-switch-service.test.ts` ("applyDefaultModel always called"), `lib/model-switching.test.ts` |
| #40 | Stale closure | Mode captured at transport-construction time; post-approve sends still tagged `mode=plan` | `services/plan-approval-service.test.ts` ("readPreviousProvider runs BEFORE setMode and applyDefaultModel" + "readPreviousProvider invoked exactly once"), `__tests__/integration/flow-cross-provider-approve.test.ts` ("previousProvider captured BEFORE applyDefaultModel overwrites the override atom"), `lib/transport-mode-reading.test.ts` |
| #44 | Lifecycle | Same-provider plan approval recreated transport, orphaning in-flight TodoWrite/Task events | `services/plan-approval-service.test.ts` ("notifyProviderChange is NOT called for Claude→Claude/Codex→Codex"), `machines/transport-lifecycle.test.ts` ("cross-provider with messages → KEEP"), `services/transport-factory.test.ts` ("PR #44 — cross-provider WITH messages → KEEP") |
| #45 | Session | Approve didn't null sessionId; server resumed the plan-mode JSONL for the agent turn | `services/plan-approval-service.test.ts` ("persistMode called with mode: 'agent' and exitPlan: true" + "persistMode awaited BEFORE scheduleDeferredSend"), `__tests__/integration/flow-session-clear-after-approve.test.ts`, `main/lib/trpc/routers/claude-mode-change.test.ts` |
| #51 | Race | Stale DB refetch reset mode atom back to "plan" after a forced flip | `machines/chat-mode-machine.test.ts` ("HYDRATE with stale version is rejected"), `services/mode-switch-service.test.ts` ("hydrate with stale version is REJECTED — no setMode call"), `__tests__/integration/flow-stale-hydration.test.ts`, also single-flight: `services/plan-approval-service.test.ts` ("two parallel approvePlan calls") |
| #52 | Cross-provider | Codex GPT-5.5 plan → Claude Sonnet approval crashed the renderer with "Maximum update depth" | `services/plan-approval-service.test.ts` ("Claude→Codex: notifyProviderChange fires" + "Codex GPT-5.5 → Claude Sonnet"), `__tests__/integration/flow-cross-provider-approve.test.ts` (full scenario), `machines/plan-approval-machine.test.ts` ("Cross-provider Codex (gpt-5.5) → Claude (sonnet) approval — PR #52 specific scenario") |

When you fix a new bug:
1. Reproduce the bug in a failing L1 or L2 test FIRST.
2. Tag the test name with the PR number.
3. Add a row to this matrix in the same PR.
4. If the bug is in a service that already has integration coverage, also add an L4 case so the multi-step flow stays guarded.

### Maintenance plan

The recurring-bug pattern in this repo had two root causes: (a) a single 8.7k-LOC file with 18+ concerns intertwined, and (b) zero tests for the bug-prone paths until PR #33. The plan below codifies the seams that prevent both.

**1. Layering, enforced by directory + import discipline.**
- `machines/` → only standard lib + intra-`machines/` types.
- `services/` → only `machines/` + standard lib.
- `hooks/` → React + `services/` + `lib/`.
- `components/` → only React + `hooks/` + `components/`.
- Promotion to `machines/` or `services/` is preferred over adding logic to `active-chat.tsx`. New `useEffect` blocks in the orchestrator are a code-smell — most are a service waiting to be extracted.

**2. The "ask before adding to active-chat.tsx" gate** (5 questions earlier in this section) — apply it on every new PR that touches the file.

**3. Coverage gates.**
- Every file in `machines/` and `services/` MUST appear in `coverage.include` of `vitest.config.ts`. The list is checked manually until we add a CI gate.
- Pure modules target 100% line coverage; service modules target ≥ 90% with the gaps being defensive branches that the FSM already guards.

**4. PR-tagged regression tests.** Every test that guards a real bug includes `PR #NN` in its `describe` or `test` name. `git grep "PR #" apps/desktop/src/renderer/features/agents/{machines,services,__tests__}` lists the audit trail.

**5. Invariants are tests, not comments.** When a service file says "X must run before Y", there's a test asserting the call order via `vi.fn().mock.invocationCallOrder` or a sequenced `events.push(...)` log. Comments rot; tests fail.

**6. Service-level wire-in path.** Each service's file header carries the imperative-source line range it replaces in `active-chat.tsx`. When a Phase 3 component is extracted, the new component imports the service rather than reaching into `appStore`/`agentChatStore` directly — the renderer's only remaining job is wiring the deps.

**7. Browser verification is non-optional for Phase 3 cuts.** The CLAUDE.md note ("verify changes by running the app in the UI") applies double when extracting a component out of `active-chat.tsx`: closures into the parent `useState` / `useRef` / atom subscriptions are easy to miss and TypeScript won't catch them. Agents without `bun run dev` access should ship Phase 3 cuts as draft PRs annotated with the smoke-test steps, never as merged commits.

**8. New features ship with a test (or an honest justification for not).** Apply the decision tree under [testing.md → When to add a test](testing.md#when-to-add-a-test-and-when-to-skip) for every new feature, hook, service, or non-trivial component. The "only if it makes sense" qualifier matters — a brittle test that pins implementation details is worse than no test. When skipping, include a one-line rationale in the commit body (e.g. _"no test — pure CSS tweak"_, _"covered by existing L4 flow-plan-to-agent suite"_). The next reader needs to know you considered it.

**9. Cross-component scope check after extracting helpers.** Two runtime crashes this branch (`messageIdSignature is not defined`, `hydratedSubChatIdsRef is not defined`) came from the same class of mistake: lifting a helper or ref out of the surrounding component without verifying that all call sites are still in the same lexical scope. After any extraction, `git grep` for every reference to the lifted symbol and confirm each one is either in the new module's scope OR can reach it via import. TypeScript will NOT catch this — JS module resolution accepts unbound identifiers as possibly-injected runtime values, and our `ts:check` is too noisy to rely on for fresh signal.

### Phase 3 wiring contract

The four services are drop-in replacements for these `active-chat.tsx` blocks. Each row gives the imperative source range, the new service entry-point, and the deps to inject.

| Concern | active-chat.tsx lines | Service | Wire-in deps |
|---|---|---|---|
| Plan approval flow | `3604–3712` (incl. consumer effect) | `approvePlan(subChatId, deps)` | `readPreviousProvider`: read `agentChatStore.get(subChatId)?.transport instanceof CodexChatTransport` then fall back to `appStore.get(subChatProviderOverridesAtom)[subChatId]`. `setMode`: write atom + `useAgentSubChatStore.getState().updateSubChatMode`. `persistMode`: `updateSubChatModeMutation.mutateAsync({ subChatId, mode: "agent", exitPlan: true })` (skip when `subChatId.startsWith("temp-")`). `applyDefaultModel`: `applyModeDefaultModel(subChatId, "agent")` then derive `isRemote` from chat metadata. `notifyProviderChange`: `onProviderChange?.(subChatId, provider)`. `resolvePlanContent`: keep current `resolveApprovedPlanContent()`. `buildImplementPlanParts`: keep current. `isInFlight`/`markInFlight`/`releaseInFlight`: read/write `planApproveInFlight: Set<string>` (module-level, kept for now). `scheduleDeferredSend`: `setPendingImplementPlan({ subChatId, parts })`. |
| Mode toggle hotkey + slash command | scattered (Shift-Tab handler + `/plan` `/agent` slash) | `toggleMode(subChatId, to, deps)` | `readState`/`writeState`: keep an FSM state ref keyed on `subChatId`. `setMode` / `applyDefaultModel` / `persistMode`: same wiring as plan approval. `notifyProviderChange`: optional. `noteSendRequested` / `noteStreamStarted` / `noteStreamCompleted` / `noteStreamErrored` are called from the matching `useChat` callbacks. |
| `dbSubChats` hydration loop | `2529–2546` | `hydrateMode(subChatId, from, hydrationVersion, deps)` | Increment `hydrationVersion` per query refetch (use `dataUpdatedAt` from React Query as the version). |
| 6 pending-message effects | `2977–3064`, `3472–3521` | `sendPendingMessage(mountSubChatId, pending, clearPending, deps)` × 6 OR a single `drainFirstPending` over the array of `(pending, clearPending)` pairs | `sendMessage`: SDK `sendMessage`. `isStreaming`: `() => status === "streaming" \|\| status === "submitted"`. The renderer keeps the six atom subscriptions; the service just collapses the body. |
| `getOrCreateChat` | `7256–7489` | `getOrCreateChat(input, deps)` | `readExistingChat`: `agentChatStore.get`. `getExistingProvider`: `existing.transport instanceof CodexChatTransport ? "codex" : "claude-code"`. `isStaleRuntime`: existing `shouldRecreateStaleRuntimeChat`. `createChat`: build the right transport (IPC/Codex/Remote) + `new Chat<any>({ id, messages, transport, onError, onFinish })`. `storeChat`: `agentChatStore.set(subChatId, chat, chatId)`. `deleteExistingChat`: `agentChatStore.delete(subChatId)`. |

When wiring, **do not** add new branches in `active-chat.tsx` for cases the service already handles. If a code review notices a service-equivalent decision being re-implemented in the renderer, that's a regression in the layering — the fix is to extend the service's deps interface, not duplicate logic.

### Phase 3 component extraction guide

`active-chat.tsx` will be cut into the components below. Each cut is independently reviewable and the order is chosen so dependent components extract last. **Cut → paste → wire → verify in `bun run dev` → component test.** Don't merge a cut that hasn't been verified in the browser.

| # | Component | Status | Purpose | Source lines (approx) | Deps to thread through |
|---|---|---|---|---|---|
| 0a | `message-group` | ✅ landed | User-message-height measurement + `content-visibility: auto` perf wrapper | extracted | `children`, `isLastGroup` |
| 0b | `split-pane-inline-close` | ✅ landed | Close button for split-pane chats | extracted | `subChatId` |
| 0c | `scroll-to-bottom-button` | ✅ landed | Sticky scroll-to-bottom with isolated scroll listener | extracted | `containerRef`, `onScrollToBottom`, `isActive`, `isSplitPane`, `subChatId` |
| 1 | `streaming-status-indicator` | n/a — already lives inside `AgentSendButton` | The `AgentSendButton` component already owns the spinner/Stop/Regenerate UI; there is no separate inline status block in `active-chat.tsx` to extract. Closed. | — | — |
| 2 | `chat-toolbar` | ✅ landed | Title editor + workspace subtitle | extracted | `subChatId`, `subChatName`, `isMobile`, `isSubChatsSidebarOpen`, `isSplitPane`, `workspaceRepoName`, `workspaceBranch`, `onRenameSubChat` |
| 3 | `plan-panel-inline` | n/a — no inline plan widget renders in `active-chat.tsx`; the Plan UI lives in the right rail (DetailsRail) and as a dock panel, both already extracted. Closed. | — | — | — |
| 4 | `pending-files-strip` | n/a — lives inside the already-extracted `ChatInputArea` (chat-input-area.tsx). Closed. | — | — | — |
| 5 | `chat-input-bar` | ✅ already extracted as `chat-input-area.tsx` (pre-Phase 3). The `selectedModel` derivation invariant from PR #52 is already in place there. | n/a | n/a |
| 6 | `chat-message-list` | ✅ already extracted as `IsolatedMessagesSection` (`agents/main/isolated-messages-section.tsx`). `ChatViewInner` mounts it via the `MessageGroupWrapper={MessageGroup}` prop. | n/a | n/a |
| 7 | `diff-sidebar-renderer` | ✅ landed | Combined `DiffStateProvider` + `DiffSidebarRenderer` + internal `DiffSidebarContent` + `CommitFileItem` + context into one module: `components/diff-sidebar.tsx` (~900 LOC). | extracted | exported as `DiffSidebarRenderer`, `DiffStateProvider`, `useDiffState` |
| 8 | `empty-state` | n/a — there is no inline empty-state JSX block in `active-chat.tsx`; the empty-message handling lives in `IsolatedMessagesSection`. Closed. | — | — | — |
| 9 | `terminal-bottom-mount` | ✅ landed | Bottom-panel mount wrapping `TerminalBottomPanelContent` | extracted | `displayMode`, `worktreePath`, `isOpen`, `isMobileFullscreen`, `chatId`, `terminalScopeKey`, `toggleTerminalHotkey`, `onClose` |

**Phase 3 status**: every entry in this table is now resolved — landed, already extracted upstream, or closed because no inline block exists in `active-chat.tsx`. The remaining ~7.1k LOC of `active-chat.tsx` is orchestration (atom subscriptions, effects, `useChat` wiring, callbacks for the imported components). The next reduction lever is wiring the Phase 2 services in (replacing the imperative blocks the services already encode).

**Audit before extracting**: when picking a candidate, `git grep` for the symbol name across `src/renderer/features/agents/` first. The Phase 3 audit revealed that `CopyButton`, `PlayButton`, and `CollapsibleSteps` were already exported from `ui/message-action-buttons.tsx` and `main/assistant-message-item.tsx` respectively — the copies in `active-chat.tsx` were dead code. Removing them was the right move, not extracting yet another duplicate.

**Invariants to preserve when extracting** (these are the ones the bug cluster is built on):
- `applyModeDefaultModel(subChatId, mode)` runs **synchronously before any `await`** in every mode-switch entry point. Three renderer call sites today plus the `mode-switch-service.toggleMode`. The plan-approval service follows the same rule.
- `previousProvider` for plan approval is captured **before** any state writes — `applyModeDefaultModel` overwrites the provider override atom as a side effect, so by the time it returns, the snapshot is gone. `services/plan-approval-service.ts:readPreviousProvider` is the seam.
- The `pendingXxxMessageAtom` consumer effects clear the atom **before** the `await sendMessage(...)` so a re-render can't fire the same prompt twice. `services/chat-send-service.ts:sendPendingMessage` enforces this in one place.
- The `isActive` guard on the `pendingBuildPlanSubChatIdAtom` consumer effect prevents two `ChatViewInner` mounts (the legacy layout + the dockview chat panel) from both running `handleApprovePlan` for the same sub-chat — that race crashed the renderer in PR #51. The single-flight Set in the plan-approval service backs this up.
- **Selected model in the input bar must be derived (`useMemo`), not synced via `useState` + bidirectional `useEffect`** — that's the PR #52 oscillation. When extracting `chat-input-bar`, keep the `selectedModel` derivation pattern from the current `chat-input-area.tsx` fix.
