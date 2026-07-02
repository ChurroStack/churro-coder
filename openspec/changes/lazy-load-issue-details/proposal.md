## Why

The work items list fetch currently retrieves full issue body/description for up to 50 issues in a single GraphQL call, loading data that is only needed when the user explicitly selects an issue. With many assigned issues this makes the initial load unnecessarily heavy and sends large payloads over IPC even when the user never reads most of them.

## What Changes

- Remove `body` field from the initial GitHub GraphQL list query
- Add a `getDetail` tRPC procedure that fetches the body of a single issue on demand (by owner, repo, number)
- Cache individual issue bodies separately so repeated selections are instant
- Update the `@`-mention selection handler and "My Work" panel insertion to call `getDetail` before serializing the issue text

## Capabilities

### New Capabilities

- `work-item-detail-fetch`: On-demand fetching and per-issue caching of issue body when a work item is selected for insertion into the chat prompt

### Modified Capabilities

- (none — no existing spec-level requirements change; the list still shows the same issues, the body just arrives later)

## Impact

- `apps/desktop/src/main/lib/work-items/github.ts` — remove `body` from list query; add `fetchIssueBody(owner, repo, number)` helper
- `apps/desktop/src/main/lib/work-items/cache.ts` — add per-issue body cache (`Map<string, string>`)
- `apps/desktop/src/main/lib/trpc/routers/work-items.ts` — add `getDetail` procedure
- `apps/desktop/src/main/lib/work-items/work-items-provider.ts` — `serialize()` can no longer use `item.body` synchronously; body must be fetched before calling serialize, or serialize becomes async
- `apps/desktop/src/renderer/features/work-items/work-items-panel.tsx` — call `getDetail` before insertion
- `apps/desktop/src/renderer/features/chat/new-chat-form.tsx` — call `getDetail` in the mention selection handler
