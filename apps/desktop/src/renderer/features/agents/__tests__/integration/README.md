# Integration tests (L4) for the chat orchestrator

These tests compose the services in `agents/services/` with the real
`applyModeDefaultModel` (and the jotai atom store wired through it) to
verify multi-step flows end-to-end. They sit between L2 service tests
(which mock every dep) and L5 e2e tests (which would launch the full
Electron app).

**Tagged to PRs.** Each `describe` block names the PR(s) it guards
against. When fixing a bug, add a test here whose name includes the PR
number — that mapping is the searchable audit trail.

**No React, no IPC, no electron.** These tests run in the default node
environment and use:

- `appStore` from `lib/jotai-store` (the real one, scoped per-test via
  `beforeEach` resets — same shape used by `model-switching.test.ts`)
- `vi.mock("../../../../lib/window-storage", ...)` to stub
  `atomWithWindowStorage` so `getOnInit` doesn't reach for `localStorage`
  during atom initialization
- `createMockTransport`, `createMockTrpc` from `test-utils/`

**What's covered**

| File                                       | Bug cluster (PRs)       | Asserts                                                                                                                                                                 |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow-plan-to-agent.test.ts`               | #36, #38, #45, #51, #44 | Approve → mode flips, model switches, transport kept, deferred send fires once with correct provider                                                                    |
| `flow-cross-provider-approve.test.ts`      | #52, #40, #44           | Approve from Codex GPT-5.5 plan with Claude agent default → previousProvider captured before atom write, transport recreate, plan attached as file part, no double-send |
| `flow-mode-toggle-mid-stream.test.ts`      | FSM rule                | Toggle rejected during streaming, accepted after STREAM_COMPLETED                                                                                                       |
| `flow-stale-hydration.test.ts`             | #51                     | Forced flip plan→agent, late DB refetch with old hydrationVersion → ignored, mode atom stays on agent                                                                   |
| `flow-session-clear-after-approve.test.ts` | #45                     | persistMode is awaited with `exitPlan: true` BEFORE deferred send schedules; failure in persist blocks the send                                                         |

These tests are **workflow assertions**, not LLM output assertions.
They never check that the model returns particular text — only that the
_workflow_ reaches the right transport with the right config in the
right order.
