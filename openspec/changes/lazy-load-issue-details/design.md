## Context

Work items (GitHub issues) are fetched via the `gh` CLI using a GraphQL query. The current query includes `body` (full description) for all issues in the list response. This data is cached in memory for 60 seconds and made available to the renderer via tRPC. The body is only consumed when the user explicitly selects an issue to insert into a chat prompt — either via the `@`-mention dropdown or the "My Work" panel click handler.

Two insertion paths exist:
1. **Mention path** (`new-chat-form.tsx`): user types `@`, picks an issue from the dropdown — body is read from the cached `WorkItem` and inserted as plain text.
2. **Panel path** (`work-items-panel.tsx`): user clicks an issue in the sidebar — `serialize()` is called which reads `item.body`.

## Goals / Non-Goals

**Goals:**
- Remove `body` from the list GraphQL query so the initial fetch is lightweight
- Add a `getDetail` tRPC procedure that fetches body for one issue on demand
- Cache per-issue bodies so repeat selections are instant (no re-fetch)
- Both insertion paths resolve the body before inserting

**Non-Goals:**
- Fetching issue comments (out of scope)
- Prefetching or background-loading bodies
- Linear support (GitHub only, same as today)
- Changing the 2000-char truncation behavior

## Decisions

### 1. Where to cache per-issue bodies

**Decision:** Add a `Map<string, string>` in `cache.ts` keyed by `"github:<owner>/<repo>#<number>"`, separate from the list cache.

**Why:** The list cache stores `WorkItem[]` and has its own TTL/eviction logic. Mixing body strings into the list items would require patching cached objects after the fact. A separate map keeps concerns clean and lets body entries be long-lived (a body rarely changes during a session).

**Alternative considered:** Store body back onto the `WorkItem` object in the list cache after fetching. Rejected — it mutates shared cache state and creates race conditions if two selections happen simultaneously.

### 2. API shape for `getDetail`

**Decision:** Add `trpc.workItems.getDetail` as a query procedure taking `{ owner: string; repo: string; number: number }`, returning `{ body: string }`.

**Why:** Matches the existing tRPC router pattern. Owner + repo + number is the minimal stable key for a GitHub issue.

**Alternative considered:** Accept a full `id` (GitHub node ID). Rejected — we don't store node IDs in the list today, and REST/GraphQL both accept owner/repo/number.

### 3. How to fetch a single issue body

**Decision:** Use the GitHub REST endpoint via `gh api` CLI: `gh api repos/{owner}/{repo}/issues/{number} --jq '.body'`.

**Why:** Simpler than a full GraphQL query for a single field. `gh api` handles auth the same way as the list query.

**Alternative considered:** Reuse GraphQL with a `node(id:)` query. Rejected — requires storing the node ID in the list, which we're removing body from anyway.

### 4. Handling the async body in insertion paths

**Decision:** Both insertion paths become async — they call `await trpc.workItems.getDetail.query(...)` before building the insertion string. The UI shows a brief loading state (existing tRPC mutation/query loading patterns apply).

**Why:** There is no synchronous way to get the body after removing it from the list. Making callers async is the honest contract.

**Alternative considered:** Make `work-items-provider.ts` pre-fetch the body when the user opens the mention dropdown. Rejected — adds complexity (how long to wait? what if no selection?) and doesn't cover the panel path.

## Risks / Trade-offs

- **Latency on selection**: User experiences a ~200–500ms delay the first time they select an issue (one `gh api` call). Mitigated by per-issue body cache — subsequent selections are instant.
- **`gh` CLI availability**: `getDetail` has the same dependency on `gh` auth as the list. If auth expires between list load and detail fetch, the error will surface at selection time rather than at list load. This is acceptable — error message already exists in the list path.
- **Concurrent selections**: If user rapidly selects the same issue twice before the first fetch completes, two `gh api` calls fire. Mitigated by an in-flight promise map in the detail fetcher (same pattern as `listInFlight` in `work-items.ts`).

## Migration Plan

No data migration needed — cache is in-memory and reset on each app launch. No schema changes. Rollout is a standard code deploy.
