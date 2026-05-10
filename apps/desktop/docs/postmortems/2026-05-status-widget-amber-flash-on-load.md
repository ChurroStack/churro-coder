# Status widget showed Code=amber "Push branch to origin" on initial workspace load

**Date:** 2026-05-10
**Severity:** Cosmetic regression on every app launch; resolved itself after ~2–5 s when git queries settled, or immediately on second visit (cache warm). Switching to another workspace and back was the user-visible workaround.
**Files touched:**
- `apps/desktop/src/renderer/features/agents/hooks/use-workflow-snapshot.ts`

---

## Symptom

Opening any workspace that had an existing open PR immediately showed the Status widget with:

- Plan ✓ green
- Code ⚠ amber — "Push branch to origin"
- Review ✓ green (or gray)
- PR ✓ green

The incorrect Code=amber state disappeared on its own after a few seconds, or instantly when the user switched to a different workspace and returned. There were no errors in the console and the underlying git state was always correct (branch was pushed, PR was open).

## What made this hard

1. **Transient and self-correcting.** The bug vanished before most investigation could start. Screenshots taken after the fact showed all-green.
2. **"Switch workspaces" workaround.** This strongly implied a caching issue rather than a logic bug, pointing early investigation toward React Query cache corruption or tRPC IPC mismatch — both of which did exist as separate issues in this codebase (see `2026-05-dockview-chat-startup-hydration.md`).
3. **Cache inspection looked healthy.** By the time `window.__qc` could be queried, `getStatus` had already resolved with `hasUpstream: true`. The race window was 2–5 s and required live capture to observe.
4. **No single wrong value.** Every individual query was correct in isolation. The bug was in how two independent queries were combined.

## Root cause

`useWorkflowSnapshot` assembles its output from five tRPC queries. Two of them feed the Code milestone:

| Query | Source of truth | Typical load time |
|---|---|---|
| `chats.getPrStatus` | gh CLI result, cached every 30 s | fast (served from 30 s cache) |
| `changes.getStatus` | git shell operations | slow (~2–5 s on cold load) |

The snapshot computes:

```typescript
hasRemote: !!gitStatus?.hasRemote || !!prStatusData?.pr || !!chat?.prNumber
hasUpstream: gitStatus?.hasUpstream ?? false   // ← bug
```

`hasRemote` uses `prStatusData?.pr` as a fallback when `gitStatus` is undefined (loading). This is correct — an open PR proves a remote exists. But `hasUpstream` had no matching fallback: it defaulted to `false` when `gitStatus` was undefined.

So during the 2–5 s window between `prStatusData` resolving (from cache) and `gitStatus` resolving (from git):

```
hasRemote = true   (from prStatusData.pr)
hasUpstream = false (from undefined gitStatus, defaulted to false)
```

`computeCode` hits this branch:

```typescript
if (!s.git.hasRemote) { /* skipped — hasRemote is true */ }
if (!s.hasUpstream) {
  return { status: 'attention', hint: 'Push branch to origin' };  // ← fires
}
```

After `getStatus` resolves and `gitStatus.hasUpstream` becomes `true`, the snapshot recomputes and Code=done. That's why the bug self-corrects.

**Why switching workspaces fixed it:** On the second visit, `getStatus` for the original workspace's `worktreePath` was still in the 30 s stale window, so the cache served `hasUpstream: true` immediately with zero lag.

## Fix

Apply the same PR-as-fallback logic that `hasRemote` already uses:

```typescript
// Before
hasUpstream: gitStatus?.hasUpstream ?? false,

// After
hasUpstream: gitStatus?.hasUpstream ?? (!!prStatusData?.pr || !!chat?.prNumber),
```

A PR cannot exist without the branch having been pushed. If `gitStatus` hasn't loaded yet but we know a PR exists (from `prStatusData.pr` or the DB-backed `chat.prNumber`), `hasUpstream` is definitively true. This eliminates the window during which the Code pill incorrectly shows amber.

Once `getStatus` resolves, its value takes over via `??` short-circuit.

## Asymmetric fallback pattern

This was an instance of **asymmetric fallback**: two snapshot fields (`hasRemote` and `hasUpstream`) represent related git facts and were intentionally given PR-based fallbacks to handle slow git queries, but only one of them actually had the fallback applied. The other silently defaulted to the pessimistic value (`false`) and triggered an alert.

The general rule: whenever a snapshot field defaults to a value that causes a user-visible alert state, check whether there is slower-loading data that provides a non-alert default, and add the same fallback that the related field uses.

## Triage heuristics for future status-widget alert flashes

1. **"Switches workspaces to fix" = cache-warm second visit works, cold first visit breaks.** This pattern always points to a loading-race between two queries with different latencies feeding the same computed boolean.

2. **Reproduce with `window.__qc`.** The global query client is exposed for debugging:
   ```js
   window.__qc.getQueryCache().getAll()
     .filter(q => JSON.stringify(q.queryKey).includes('getStatus'))
     .map(q => ({ key: JSON.stringify(q.queryKey), data: q.state.data, status: q.state.status }))
   ```
   Drop the `getStatus` cache entry with `.remove(entry)` and screenshot immediately to catch the alert flash before it self-corrects.

3. **Check `computeCode` / `computeWorkflowState` with null inputs manually.** Before chasing cache bugs, trace every input to `computeWorkflowState` as if a single slow query hasn't resolved yet. Plug `undefined` for each query's data in turn and see which branch fires.

4. **Identify mismatched fallbacks.** If `fieldA` (e.g. `hasRemote`) uses a fallback from fast-loading data and `fieldB` (e.g. `hasUpstream`) uses `?? false`, and `computeCode` only reaches the `fieldB` alert branch when `fieldA` is truthy — the asymmetry is the bug. The fix is always: give `fieldB` the same fast-loading fallback as `fieldA`.

5. **Confirm the fix holds under the race, not just at steady state.** Clear the slow query's cache entry (`window.__qc.getQueryCache().remove(entry)`) while the fast query is still warm, then screenshot. If the alert is gone, the fix is correct. If the alert reappears, a fallback was missed.

6. **Don't confuse this class with the `{ success: true }` cache pollution bug.** Cache pollution (`chats.get` holding a mutation result shape) is a separate regression documented in `2026-05-dockview-chat-startup-hydration.md`. That bug does not self-correct and appears immediately regardless of query load order.

## Verification

- `cd apps/desktop && bun run test` → 1068/1068 tests passed.
- Playwright reproduce: dropped `getStatus` cache entry via `window.__qc` while `getPrStatus` was warm → Code remained green throughout the refetch window.
- Screenshots before and after fix confirmed: initial load no longer flashes amber.
