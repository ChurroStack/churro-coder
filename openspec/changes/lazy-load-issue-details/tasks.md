## 1. Remove body from list query

- [ ] 1.1 In `apps/desktop/src/main/lib/work-items/github.ts`, remove the `body` field from the GraphQL list query
- [ ] 1.2 Update the `WorkItem` type in `types.ts` to make `body` optional (`body?: string`)

## 2. Add per-issue body cache

- [ ] 2.1 In `apps/desktop/src/main/lib/work-items/cache.ts`, add a `Map<string, string>` for per-issue bodies with `getBodyCache`, `setBodyCache` helpers keyed by `"github:<owner>/<repo>#<number>"`
- [ ] 2.2 Add an in-flight promise map (`Map<string, Promise<string>>`) to coalesce concurrent requests for the same issue

## 3. Add fetchIssueBody helper

- [ ] 3.1 In `apps/desktop/src/main/lib/work-items/github.ts`, add `fetchIssueBody(owner: string, repo: string, number: number): Promise<string>` that calls `gh api repos/{owner}/{repo}/issues/{number} --jq '.body'`
- [ ] 3.2 Handle the case where body is null/empty (return `""`)
- [ ] 3.3 Handle `gh` CLI errors (throw with a descriptive message)

## 4. Add getDetail tRPC procedure

- [ ] 4.1 In `apps/desktop/src/main/lib/trpc/routers/work-items.ts`, add a `getDetail` query procedure accepting `{ owner: string; repo: string; number: number }`
- [ ] 4.2 In the procedure, check the body cache first; on miss, call `fetchIssueBody`, store result in cache (using the in-flight map to coalesce), and return `{ body: string }`

## 5. Update mention insertion path

- [ ] 5.1 In `apps/desktop/src/renderer/features/chat/new-chat-form.tsx`, update the GitHub issue mention selection handler to call `trpc.workItems.getDetail.query(...)` and await the body before constructing the insertion string
- [ ] 5.2 Ensure the UI does not block during the fetch (the handler is already async via the mention system)

## 6. Update panel insertion path

- [ ] 6.1 In `apps/desktop/src/renderer/features/work-items/work-items-panel.tsx`, update the click handler to call `trpc.workItems.getDetail.query(...)` before calling `onInsert` with the serialized text including the body
- [ ] 6.2 Add a per-row loading state or disable the row while the fetch is in flight to prevent double-clicks

## 7. Update work-items-provider serialize

- [ ] 7.1 In `apps/desktop/src/main/lib/work-items/work-items-provider.ts`, update `serialize()` to accept an optional `body` parameter (or remove body from the method if callers now handle it), so the method stays compatible with the `body`-less `WorkItem`

## 8. Verify & test

- [ ] 8.1 Run `bun run test` in `apps/desktop` and confirm all existing work-items tests pass
- [ ] 8.2 Run `bun run build` in `apps/desktop` to confirm no TypeScript errors
