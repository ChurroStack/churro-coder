# Workflow Status state machine

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

The right-rail **Status widget** (4-pill stepper: Plan → Code → Review → PR) and the **notch** above the chat input (chip + primary button) are both driven by a single pure state machine. There is no per-component logic for "what's the next step" — both surfaces consume the same `WorkflowState` and dispatch through the same `useWorkflowActions`.

## Pure state machine — `agents/utils/workflow-state.ts`

`computeWorkflowState(inputs: WorkflowInputs): WorkflowState` is **dependency-free** (no React, no jotai, no tRPC). It maps inputs → 4 milestones (each with `status: idle | in_progress | attention | info | done`) plus a single `next` action. Don't add React/jotai/tRPC imports here — that breaks unit testability and creates circular ownership with the hook.

Status semantics (color is a hint, not a strict rule):

| Status        | Color           | Meaning                          | Example                                    |
|---------------|-----------------|----------------------------------|--------------------------------------------|
| `idle`        | gray            | Future / not relevant            | "Plan" in agent-mode chats                 |
| `in_progress` | blue (animated) | AI/system is working             | "Code" while agent is editing              |
| `attention`   | amber           | User action required             | "Plan ready — approve" / "Push branch"     |
| `info`        | blue            | Informational, not blocking      | PR is open, awaiting reviewer              |
| `done`        | green           | Completed                        | Plan approved / code pushed / PR merged    |

`next` selection cascades: first milestone (in order plan → code → review → pr) whose status is `attention` *with* an `actionKind`, falling back to the first `in_progress` *with* an `actionKind`. This guarantees only **one** milestone owns the "next" slot at any time — no two pills can simultaneously claim it.

`computeCode` reads `plan.status` and `computeReview` reads `code.status` and `computePr` reads both — the cascade is the only coupling between milestones.

## WorkflowSnapshot — single typed input

`WorkflowSnapshot` (defined in `workflow-state.ts`) is the single typed input to `computeWorkflowState`. Fields:

```ts
interface WorkflowSnapshot {
  mode: 'plan' | 'execute' | 'explore' | 'review';
  activity: 'idle' | 'streaming' | 'compacting';
  plan: { exists: boolean; meta?: { approvedAt?: string } } | null;   // null = query loading
  review: { exists: boolean } | null;                                  // null = query loading
  git: { changedFiles: number; headSha: string; hasRemote: boolean };
  pushCount: number;
  hasUpstream: boolean;
  baseBranchBehind: number;
  pr: { state: 'none'|'draft'|'open'|'merged'|'closed'; reviewDecision: string; creating: boolean };
  hasHistory: boolean;   // AI has completed ≥1 streaming response in this sub-chat
}
```

- **`plan`** — from `chats.getCurrentPlan({ subChatId })` (PR 4). `plan.exists && plan.meta?.approvedAt` = plan approved and done. Replaces the deleted `planEverGeneratedAtomFamily` (localStorage).
- **`review`** — from `chats.getCurrentReview`. `review.exists` = review artifact on disk (written by `write_review` MCP tool). Replaces the deleted `localReviewCompletedAtomFamily` (localStorage).
- **`git.headSha`** — reserved for PR 5 review-staleness check; currently always `''`.
- **`hasHistory`** — from `aiEverRespondedAtomFamily`; guards the Code milestone from showing "Up to date" before any AI work.

Built by `useWorkflowSnapshot(chatId, subChatId)` in `hooks/use-workflow-snapshot.ts`.

## React glue — `agents/hooks/use-workflow-state.ts`

Two hooks:

- **`useWorkflowState(chatId, subChatId) → WorkflowState | null`** — calls `useWorkflowSnapshot()` to assemble the snapshot, then passes it to `computeWorkflowState`. Also manages write side-effects: marks `aiEverResponded` when streaming ends, clears `prCreating` when a PR appears or the remote is absent, and invalidates `getPrStatus`/`getStatus`/`getCurrentPlan` after each agent run.
- **`useWorkflowActions(chatId, subChatId) → { dispatch, pushDialog }`** — central dispatcher for every milestone action (`expandPlan`, `mergeBase`, `pushBranch`, `reviewLocal`, `reviewPr`, `createPr`, `openPr`).

Both hooks are mounted in two places: `DetailsRail` (drives the Status widget) and `ChatViewInner` (drives the notch). tRPC dedupes the queries by key, so the cost is mostly redundant `useEffect` runs — idempotent and acceptable.

## `pendingXxxMessageAtom` pattern — cross-component AI prompts

Several actions need the active sub-chat's `ChatViewInner` to send a message that was authored elsewhere (the diff panel, the rail, the PR widget). The convention is to write the prompt into a jotai atom; `ChatViewInner` has a `useEffect` that consumes the atom and calls `sendMessage`.

Atoms in this family (all in `agents/atoms/index.ts`):

- `pendingPrMessageAtom` — "Create a pull request…" prompt
- `pendingReviewMessageAtom` — `/review` prompt with PR context
- `pendingConflictResolutionMessageAtom` — merge-conflict resolution prompt
- `pendingMergeBaseMessageAtom` — "Merge latest from {baseBranch}…" prompt
- `pendingBuildPlanSubChatIdAtom` — triggers `handleApprovePlan` for the matching sub-chat (no message — just an ID flag)
- `pendingImplementPlan` (local React state, not jotai) — set immediately after plan approval

Each atom has a sibling `useEffect` in `ChatViewInner` that:
1. Checks `pendingMessage?.subChatId === subChatId && !isStreaming`
2. **Clears the atom first** (`setPendingMessage(null)`) to prevent double-sending
3. Calls `sendMessage({ role: "user", parts: [{ type: "text", text: ... }] })`

When adding a new cross-component prompt: declare the atom alongside the existing trio, write the consumer effect in `ChatViewInner` next to `pendingPrMessage`/`pendingReviewMessage`, and route writes through `useWorkflowActions.dispatch`.

## Critical invariants — do not break

- **Model-switch ordering.** When triggering an AI review from outside the chat tree, `applyModeDefaultModel(subChatId, "review")` MUST run synchronously **before** any `await` — the transport reads `subChatModelIdAtomFamily(subChatId)` at send-time, and yielding the event loop before setting the model means the chat input flips visibly *after* the review prompt appears (or worse, the prompt is sent with the previous model). Three call sites enforce this: `diff-panel.tsx:handleReview`, `active-chat.tsx:handleReview`, `use-workflow-state.ts:dispatch("reviewPr")`. Verify the order if you touch any of them.
- **`computeWorkflowState` stays pure.** No imports from `react`, `jotai`, `@trpc/*`, or anything in `apps/desktop/src/renderer/features/`. The hook does the I/O; the function does the math.
- **`next` is the single source of truth for the primary action.** Don't read individual milestones to decide what button to show — read `workflow.next.actionKind`. The notch and rail must agree, which they do because both read `workflow.next`.
- **Stale-PR detection.** When `prState` is `open` or `merged` but the local tree has uncommitted files (`changedFilesCount > 0`) or unpushed commits (`hasUpstream && pushCount > 0`), `computePr` returns `attention` (not `done`) with `actionKind: 'createPr'`. `computeReview` mirrors this. The single `createPr` dispatch prompt commits, pushes, and only creates a PR if one doesn't already exist. The `next` cascade special-cases this: when PR is amber-stale, the iteration order becomes `[pr, plan, code, review]` so the user is steered toward the end-to-end action instead of an intermediate "push first" suggestion.
- **"View plan" opens the dock panel.** `useWorkflowActions.dispatch("expandPlan")` is the single workflow entry point; tool-row buttons in `agent-plan-tool.tsx` / `agent-plan-file-tool.tsx` call `addOrFocus` directly because they have a more specific `planPath` (virtual `codex-plan://...` URI / Write-tool file path) than the sub-chat's persisted `currentPlanPath`.
- **`baseBranchBehind` requires a fresh fetch.** `getPrStatus` runs a quiet `git fetch origin <baseBranch>` (8 s timeout, errors swallowed) before the `git rev-list --count HEAD..origin/<baseBranch>`. Without the fetch, `origin/<baseBranch>` is whatever was last fetched and the count silently under-reports.
- **`hasRemote` is distinct from `hasUpstream`.** `hasRemote = false` means *no* remote is configured at all (Code shows "Changes ready (no remote)", PR is permanently idle). `hasUpstream = false` with `hasRemote = true` means a remote exists but the local branch isn't tracking it (Code goes amber → "Push branch to origin"). The Status widget treats these as different states; don't conflate them.
- **`prCreating` self-clears on failure.** Three effects in `useWorkflowState` clear the optimistic spinner: when a PR shows up in `getPrStatus`, when `hasRemote === false`, and 10 s after the AI stream ends without a PR appearing. Adding a new "create PR" entry point should NOT bypass `prCreatingAtomFamily` — the spinner is the only signal the user has that the action is in flight.

## Dispatcher invalidation table

`useWorkflowActions.dispatch` fires these tRPC invalidations per action. The post-streaming invalidation in `useWorkflowState` applies to all actions unconditionally.

| Action | Immediate invalidation | Notes |
|---|---|---|
| `expandPlan` | — | UI-only (opens dock panel) |
| `mergeBase` | `getPrStatus`, `changes.getStatus` | Agent does the actual merge; streaming-end effect re-invalidates when done |
| `pushBranch` | `getPrStatus`, `changes.getStatus` | On success of the push operation |
| `reviewLocal` | — | Sets `localReviewCompletedAtomFamily`; opens diff sidebar |
| `reviewPr` | — | One-shot `getPrContext` read; sets `pendingReviewMessageAtom` |
| `createPr` | — | Sets `prCreatingAtom`; `getPrStatus` poll picks up the new PR |
| `openPr` | — | Opens external URL |

**Post-streaming (always):** `useWorkflowState` invalidates `getPrStatus` and `changes.getStatus` whenever `isStreaming` transitions `true → false`. This ensures every agent run (merge, review, PR creation) produces fresh milestone data without waiting for the 30 s poll.

## Context clear-points table

| Moment | Trigger | Session behavior | Bootstrap |
|---|---|---|---|
| Plan → Implement | "Approve plan" notch/message button | `exitPlan: true` → null `sessionId`; mode→execute | `workflow/implement-plan.j2` + `read_plan` MCP |
| Implement → Review | "Review" notch button | `clearSession: true` → null `sessionId`; mode→review | `workflow/review.j2` + `read_plan` MCP |
| Review → Fix | "Apply review" notch/message/widget | `clearSession: true` → null `sessionId`; mode→execute | `workflow/apply-review.j2` + `read_review` MCP |
| Manual mode-pill toggle | User clicks mode pill | `clearSession: true` when destination ≠ active `sessionMode` | None (user-driven) |
| Provider switch | User changes provider | RECREATE transport, `sessionId` nulled per provider | None |
| Model switch within provider | User changes model | Session reused | None |
| Compact / New chat | User-explicit | Clears | None |

## Per-subChat persisted state

Atom families in `details-sidebar/atoms/index.ts` track milestone state per-subChat across reloads:

- `aiEverRespondedAtomFamily(subChatId)` — `hasHistory` in the snapshot; prevents Code from showing "Up to date" before any AI work. Persisted (`overview:aiEverResponded`).
- `prCreatingAtomFamily(subChatId)` — optimistic PR-creation spinner. **In-memory only** (resets on reload by design — recovery is via the next `getPrStatus` poll).
- ~~`planEverGeneratedAtomFamily`~~ — **deleted (PR 4)**. Plan "done" is now driven by `chats.getCurrentPlan.meta.approvedAt` (file artifact, not localStorage).
- ~~`localReviewCompletedAtomFamily`~~ — **deleted (PR 4)**. Review "done" will be driven by `chats.getCurrentReview` (PR 5 file artifact).

Backend changes that feed this:

- `GitChangesStatus.hasRemote: boolean` (in `shared/changes-types.ts`, populated by `main/lib/git/status.ts`).
- `getPrStatus` returns `baseBranchBehind: number` (in `main/lib/trpc/routers/chats.ts`) — runs the quiet fetch + `rev-list`.
- `getCurrentPlan({ subChatId })` (PR 4) — returns `{ exists: boolean; meta?: { approvedAt? } }` from the plan file artifact.
- `getCurrentReview({ subChatId })` (PR 5) — returns `{ exists: boolean; content?: string; meta?: { appliedAt? } }` from the review file artifact (written by `write_review` MCP tool).
