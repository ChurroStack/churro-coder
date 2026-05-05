# Current Status

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

This file is a changelog-style log of recently completed work and known limitations. Trim aggressively — only keep entries that are still load-bearing context for ongoing work.

## Done (this branch — Phase 2 services + L4 integration battery + Phase 3 complete)

- Four services in `src/renderer/features/agents/services/`: `plan-approval-service`, `mode-switch-service`, `chat-send-service`, `transport-factory`. Each composes the corresponding pure machine with injected side-effect deps so the orchestration is testable end-to-end without React/jotai/tRPC.
- 68 L2 service tests across 4 files — encode invariants from PRs #36 / #38 / #40 / #44 / #45 / #51 / #52. See the bug-cluster regression matrix in [chat-orchestrator.md](chat-orchestrator.md#bug-cluster-regression-matrix).
- 19 L4 integration tests in `src/renderer/features/agents/__tests__/integration/`: `flow-plan-to-agent`, `flow-cross-provider-approve`, `flow-mode-toggle-mid-stream`, `flow-stale-hydration`, `flow-session-clear-after-approve`.
- **Phase 3 complete** — all extractable components moved out of `active-chat.tsx`:
  - `MessageGroup` → `components/message-group.tsx`
  - `SplitPaneInlineClose` → `components/split-pane-inline-close.tsx`
  - `ScrollToBottomButton` → `components/scroll-to-bottom-button.tsx`
  - `ChatToolbar` → `components/chat-toolbar.tsx`
  - `TerminalBottomMount` → `components/terminal-bottom-mount.tsx`
  - **`diff-sidebar` module** → `components/diff-sidebar.tsx` — bundled `DiffStateProvider`, `DiffSidebarRenderer`, `DiffSidebarContent`, `CommitFileItem`, and the `useDiffState` context (~900 LOC moved as one cohesive surgery).
  - 15 L3 component tests (jsdom + RTL) for the simpler ones.
- **Phase 3 closed entries** — `streaming-status-indicator`, `pending-files-strip`, `chat-input-bar`, `chat-message-list`, `empty-state`, and `plan-panel-inline` from the original playbook had no extractable block in `active-chat.tsx` because they were already extracted (`AgentSendButton`, `ChatInputArea`, `IsolatedMessagesSection`) or the playbook entry was speculative.
- **Dead-code purged from `active-chat.tsx`**: `CopyButton`, `PlayButton` (with `PlayButtonState` / `PLAYBACK_SPEEDS` / `PlaybackSpeed` types), `CollapsibleSteps`, and the unused `ttsPlaybackRate` state were all dead code — the live versions live in `ui/message-action-buttons.tsx` and `main/assistant-message-item.tsx`. Removing them + the Phase 3 cuts shrunk the file from 8730 → 7117 LOC (~1600 LOC removed) and let us drop ~24 now-unused imports.
- `vitest.config.ts` `coverage.include` extended for the four service modules + the three new component modules with tests.
- AGENTS.md gained a maintenance plan, a bug-cluster regression matrix, a Phase 3 wiring contract (service-by-service deps wiring guide), and a Phase 3 component extraction order.
- `bun run build` clean. 444/444 tests pass.

## Done (previous branch — Status widget)

- Pure `computeWorkflowState` state machine (`agents/utils/workflow-state.ts`) — single source of truth for Plan / Code / Review / PR milestones + `next` action.
- `useWorkflowState` + `useWorkflowActions` hooks (`agents/hooks/use-workflow-state.ts`) — wire jotai/tRPC → state machine and centralize the dispatch path.
- New right-rail Status widget (4-pill stepper) and refactored notch above the chat input — both consume the same `WorkflowState`.
- `pendingMergeBaseMessageAtom` (cross-component "merge from base" prompt) added alongside the existing `pendingPrMessageAtom` / `pendingReviewMessageAtom` / `pendingConflictResolutionMessageAtom`.
- `GitChangesStatus.hasRemote` (no-remote vs no-upstream distinction) and `getPrStatus.baseBranchBehind` (with quiet `git fetch` so the count is fresh).
- PR widget's "Review pending" / "Changes requested" rows are clickable and reuse the same `reviewPr` dispatch path.
- Plan dockview panel (`PlanPanel`) gained an Approve button (writes `pendingBuildPlanSubChatIdAtom` — same atom the sidebar widget uses; closes the panel + activates the chat panel after approve) and made its content scrollable when full-height.
- `applyModeDefaultModel(subChatId, "review")` is invoked synchronously **before** any `await` in all three review entry points so the chat input visibly flips to the configured review model before the prompt is sent.
- Diff panel header's Review button is no longer gated on `diffStats.hasChanges` — it's available whenever an `onReview` handler is wired (in-memory diff cache resets on reload and never lights up for untracked-only fresh repos).

## Done (previous branch — windowing refactor)

- Outer gridview shell (left rail / center / right rail).
- DockviewReact center cell with stable-id panels for chat / terminal / file / plan / diff / search / files-tree.
- Per-workspace `WorkspaceDockShell`s, visibility-toggled — terminal PTYs and chat streams survive workspace switches.
- Per-workspace dock layout persistence + global shell layout (schema v3).
- Widget ↔ panel mutex (Plan / Changes / Terminal).
- Renamable tabs, per-kind tab icons, last-tab close guard, confirm-on-close for chat & terminal tabs.
- Per-group `[+]` / Chat / Terminal header actions.
- Hotkeys: ⌘T (new chat), ⌘⇧T (new terminal), ⌘P (file picker), ⌘⇧F (search), ⌘D (open Changes panel).
- System-view overlay for Settings / Usage / Kanban / Automations / Inbox / New Workspace.
- Diff panel: ChangesPanel + AgentDiffView + DiffSidebarHeader, with Review / Create PR / Merge / Fix-conflicts wired.

## Done (this branch — deps hooks + composer + L4 form-binding)

- **`flow-form-binding-on-new-subchat.test.ts`** — 7 L4 tests covering PR #38 regression class. Closes the L4 gap from the original plan. Drives the real `applyModeDefaultModel` via `mode-switch-service.toggleMode` to verify per-mode default propagation, sync ordering (PR #36), cross-provider defaults, and per-subChatId isolation (PR #51).
- **`useModeSwitchDeps`** hook — extracted the mode-switch service deps from `ChatViewInner`. The renderer now calls `useModeSwitchDeps(updateSubChatModeMutation)` instead of building the deps inline.
- **`useTransportFactoryDeps`** hook — extracted the ~280 LOC factory deps block (FSM-decision deps + the 140-LOC `createChat` callback with onError/onFinish lifecycle hooks) from `getOrCreateChat`. The renderer's `getOrCreateChat` is now a thin caller around the FSM decision + the deps from this hook. Reduced `active-chat.tsx` by ~270 LOC.
- **`useApprovePlanDeps`** hook — extracted the ~80 LOC plan-approval deps from `handleApprovePlan`. The renderer's `handleApprovePlan` is now a 5-line wrapper around `approvePlanService(subChatId, planDeps)`. Reduced `active-chat.tsx` by ~110 LOC.
- **`useChatController`** composer hook — the public API the original plan called out as "composes all hooks for active-chat.tsx". Bundles `useChatViewState` + the three deps hooks into a single typed return. The renderer keeps its individual hook calls (the per-call inputs are scattered across the file), but components extracted from `ChatViewInner` will use the composer to get everything per-subChatId in one shot.
- **L3.5 hook tests** for the controller (7 tests): mount, return-shape contract, viewState read/write, per-subChatId isolation, persistMode skip-temp-id behavior, persistMode awaits the mutation. Uses structural mocks for the IPC/Codex/Remote transports so the test runs in node without an electronTRPC global.
- **`lib/chat-instance-helpers.ts`** — pure helpers (`parseStoredMessages`, `getChatMessages`, `shouldRecreateStaleRuntimeChat`) lifted out of `active-chat.tsx` so the transport-factory hook can import them without circling back through the renderer.
- **`lib/implement-plan-parts.ts`** — `IMPLEMENT_PLAN_BASE_TEXT` + `buildImplementPlanParts` + `ApprovedPlanContent` lifted out of `active-chat.tsx` for the approve-plan hook.
- **`active-chat.tsx` LOC: 7,389 → 7,006** (~383 LOC removed via deps-hook extractions; behavior unchanged).

## Done (previous — Phase 2 fully wired + L3.5 hook layer)

- All four Phase 2 services are now wired through `ChatViewInner`:
  - **`chat-send-service.sendPendingMessage`** — the six near-identical pending-message effects (`pendingPrMessage`, `pendingReviewMessage`, `pendingConflictResolutionMessage`, `pendingMergeBaseMessage`, `pendingContinueMessage`, `pendingImplementPlan`) collapse to a single 3-line call each via a `sendPending` wrapper. Clear-before-await invariant sourced from the service.
  - **`mode-switch-service.hydrateMode`** — the `dbSubChats` initialization loop now hydrates each sub-chat through the FSM exactly once (tracked in `hydratedSubChatIdsRef`). PR #51 stale-refetch race is locked in by the FSM's hydrationVersion guard, not the legacy `knownModes[id] === undefined` check.
  - **`mode-switch-service.toggleMode`** — `handleModeChange` (the user-toggle entry point) goes through the service, which adds three invariants the legacy code missed: PR #36 sync-before-await, PR #38 per-mode default propagation, PR #51 activity-gate against mid-stream toggles. A new effect maps `useChat.status` → FSM events (`noteSendRequested` / `noteStreamStarted` / `noteStreamCompleted` / `noteStreamErrored`) so the activity gate has live data.
  - **`transport-factory.getOrCreateChat`** — replaces the imperative branching with the FSM in `decideTransportAction`. Behavior parity verified: existing+remote → KEEP, stale+idle → RECREATE, provider match → KEEP, cross-provider with messages → KEEP (PR #44), cross-provider empty → RECREATE. The 140-LOC `createChat` callback (Chat instantiation + onError/onFinish) lives inline as a dep so tests can substitute a mock transport.
  - **`plan-approval-service.approvePlan`** — replaces `handleApprovePlan` entirely. The renderer wires deps; every invariant from PRs #36, #38, #40, #44, #45, #51, #52 lives in the service. `buildImplementPlanParts` adapts the FSM's `ImplementPlanPayload` back into the renderer's existing helper for the file-content layout.
- New atom: `chatModeFsmStateAtomFamily(subChatId)` — per-subChatId FSM state container shared by all the mode/plan services as their `readState` / `writeState` deps. In-memory only; derivable from `subChatModeAtomFamily` + `useChat.status` after a fresh launch.
- `useChatViewState(subChatId)` hook landed in `agents/hooks/use-chat-view-state.ts`. Bundles the per-subChatId **configuration** atoms (`mode`, `modelId`, `codexModelId`, `codexThinking`, `claudeThinking`, `providerOverride`) with their setters into a single typed return. Components extracted from ChatViewInner can call the hook to read the same slice without re-deriving each atomFamily binding.
- L3.5 hook test layer: `agents/hooks/use-chat-view-state.test.tsx` (7 tests) — covers default values, individual setters, per-subChatId isolation, and the PR #51-style cross-subchat bleed regression class. Uses `renderHook` from RTL with a fresh jotai store per test.

## Known limitations / deferred

- `active-chat.tsx` LOC went from ~7.1k to ~7.4k (the deps blocks add overhead). The wins aren't LOC — they're: (a) every imperative path is now a thin wrapper around an L2-tested service; (b) the bug-cluster invariants (PRs #36–#52) live in the service code, not the renderer; (c) future PRs touching mode/plan/transport edit the service tests, not the renderer. Further LOC reduction would require extracting the renderer's deps wiring into hooks (e.g., `useApprovePlanDeps(subChatId)`, `useTransportFactoryDeps(...)`) — small, safe follow-ups.
- The chat-mode FSM activity tracking is wired, but the toggle UI in `chat-input-area.tsx` doesn't yet gate on `activity === "idle"` — it gates on `useChat.status` directly. The service silently rejects busy toggles with a `console.warn`. UI gating is a small follow-up.
- `useChatViewState` is the **configuration** slice only — activity flags (`isStreaming`, error state), pending-message atoms (now wired through the send service but still subscribed in ChatViewInner), and FSM state have different lifecycles and live elsewhere. The hook is intentionally narrow so the test surface stays focused.
- Mobile branch (`agents-content.tsx if (isMobile)`) still uses legacy `TerminalSidebar` / `KanbanView` dispatch — unaudited against the dockview changes.
- Display-mode atoms (`terminalDisplayModeAtom`, `diffViewDisplayModeAtom`, `fileViewerDisplayModeAtom` + `*SidebarOpenAtomFamily` siblings) are vestigial but still consumed by `changes-view.tsx` / `agent-diff-view.tsx` / `git-activity-badges.tsx` / `agent-plan-file-tool.tsx` / mobile `terminal-sidebar.tsx`. Removal is a 7-file follow-up.
- `chats.listArchived` / `chats.restore` / `chats.deleteAllArchived` were removed; Cmd+Z workspace undo is a no-op (sub-chat undo still works). The `archived_at` column remains in the schema and is filtered out by `chats.list`.
- `mock-api.ts` still wraps `trpc.chats.listArchived` / `restore` but has no live consumers — TypeScript-only.
- Several pre-existing hotkeys (`prev-agent`, `next-agent`, `archive-workspace`, `archive-agent`, etc.) lack handlers in `AGENT_ACTIONS`. Not introduced by this refactor.
