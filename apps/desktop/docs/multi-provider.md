# Multi-Provider Interleaved Conversations

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

Users can switch between Claude and Codex mid-conversation within the same sub-chat tab. The provider change is tracked in `subChatProviderOverrides` (local React state in `active-chat.tsx`); switching destroys and recreates the transport via `agentChatStore.delete(subChatId)`.

## Catch-up mechanism

When the active provider differs from the one that produced recent turns, a `[CATCHUP]` block is prepended to the outgoing prompt so the new provider has context. **The block is sent to the live provider only — it is never persisted to the DB.**

Key files:
- `src/shared/provider-from-model.ts` — `getProviderForModelId(modelId)` classifies any model ID as `"claude-code" | "codex"`. Import this from both main and renderer; do NOT duplicate the logic.
- `src/main/lib/multi-provider/catchup.ts` — pure `computeCatchupBlock(messages, provider, options?)`. Call it with the full `messagesForStream` array (including the trailing user message being sent); it strips the trailing user before searching for the provider boundary. Pass `{ forceFullHistory: true }` when the session is known to be fresh/expired.
- `src/main/lib/trpc/routers/claude.ts` — catch-up wired just before `queryOptions` assembly. Proactively checks if the session JSONL file exists; if missing, clears `resumeSessionId` and sets `isSessionFresh = true` so `forceFullHistory` fires.
- `src/main/lib/trpc/routers/codex.ts` — catch-up wired just before `turn/start`.

## Critical invariants — do not break

- **Boundary search excludes the trailing user message.** The trailing Codex user message (with `metadata.model = "gpt-5.4/high"`) would otherwise be found first and set `boundaryIdx` to the last position, making the catch-up window empty.
- **`getLastSessionId` in the Codex router only returns Codex thread IDs.** It filters to assistant messages where `getProviderForModelId(metadata.model) === "codex"` so Claude session UUIDs are not passed to app-server `thread/resume`.
- **The Codex router treats `input.sessionId` as a fallback only.** The renderer reads `sessionId` from the last AI SDK assistant message, which after a Claude turn can be a Claude UUID. Prefer the in-process `subChatId -> threadId` map, then DB-resident `getLastSessionId(existingMessages)`.
- **Codex UI model IDs use `"baseModel/thinkingLevel"` format** (e.g. `"gpt-5.4/high"`). Split this into `model` and `effort` when calling app-server.

## Codex cost computation

`CODEX_MODEL_PRICING` in `src/main/lib/codex/usage-metadata.ts` maps base model IDs (suffix stripped) to per-1M-token input/cached-input/output rates. Cost is computed in `mapAppServerUsageToMetadata` and stored as `totalCostUsd` in the assistant message metadata — the same field Claude uses — so the recap UI renders it identically.
