import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { IDockviewPanelProps } from 'dockview-react';
import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { AgentsContent } from '../../agents/ui/agents-content';
import { ChatCliSurface } from '../../agents/ui/chat-cli-surface';
import { CliPromptBar } from '../../agents/ui/cli-prompt-bar';
import { selectedAgentChatIdAtom } from '../../agents/atoms';
import { trpc } from '../../../lib/trpc';
import { appStore } from '../../../lib/jotai-store';
import type { ChatPanelEntity } from '../atoms';
import { useDockWorkspace } from '../workspace-context';
import { OpenSpecChangePanelContent } from './openspec-change-panel';
import { useSubChatOwnership } from '../../agents/hooks/use-sub-chat-ownership';
import { useWindowId } from '../../../contexts/WindowContext';
import { openSpecStopHandlerAtomFamily } from '../../openspec/atoms';
import { agentChatStore } from '../../agents/stores/agent-chat-store';
import { useStuckDetection } from '../../agents/hooks/use-stuck-detection';
import { subChatHardResetHandlerAtomFamily } from '../../agents/atoms/stuck-detection';

/**
 * ChatPanel — one dockview tab per open sub-chat. Each tab carries
 * `subChatId + chatId` in its params; the panel renders `<AgentsContent />`
 * which mounts ChatView for the parent chat.
 *
 * Visibility model: dockview gives us *two* notions of "active":
 * - `api.isActive` — global; only one panel across the whole dockview is
 *   the focused panel.
 * - `api.isVisible` — per-group; true when this panel is the active tab
 *   in its own group, regardless of whether its group has focus.
 *
 * For rendering content we want `isVisible` so each side of a split shows
 * its own chat — using `isActive` meant only the globally-focused panel
 * rendered, leaving the other side blank.
 *
 * For pushing `activeSubChatId` into the store we still want `isActive` —
 * that's what the right-rail widgets / hotkeys treat as "the chat the
 * user is currently looking at".
 *
 * ChatPanel passes its own sub-chat id through to ChatView, so each visible
 * split pane renders its own conversation while only the focused panel writes
 * global active-chat state.
 *
 * The opposite direction (store openSubChatIds → dockview) lives in
 * [chat-panel-sync.tsx].
 */
export function ChatPanel({ params, api, containerApi }: IDockviewPanelProps<ChatPanelEntity>) {
  const [isVisible, setIsVisible] = useState(api.isVisible);
  const [isActive, setIsActive] = useState(api.isActive);
  const { active: isWorkspaceActive } = useDockWorkspace();
  const windowIdStr = useWindowId();
  const windowId = parseInt(windowIdStr, 10) || 1;
  const paneId = `chat:${params.subChatId}`;
  const { isOwner, takeOver } = useSubChatOwnership(params.subChatId, windowId, paneId);
  const stopHandlerAtom = useMemo(() => openSpecStopHandlerAtomFamily(params.subChatId), [params.subChatId]);
  const stopHandler = useAtomValue(stopHandlerAtom);
  const [builtinRemountKey, setBuiltinRemountKey] = useState(0);
  const setActiveSubChat = useAgentSubChatStore((s) => s.setActiveSubChat);
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId);
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds);
  const allSubChats = useAgentSubChatStore((s) => s.allSubChats);
  const subChat = allSubChats.find((x) => x.id === params.subChatId);
  const openspecChangeId = params.openspecChangeId ?? subChat?.openspecChangeId ?? null;
  const openspecProjectId = params.projectId ?? subChat?.projectId;
  const openspecChangePath =
    params.openspecChangePath ??
    subChat?.openspecChangePath ??
    (openspecChangeId ? `openspec/changes/${openspecChangeId}` : undefined);
  // params.harness is the authoritative source: it travels through dockview
  // params on drag-drop, tear-out, and layout deserialization so the surface
  // router resolves immediately — before the async store/query hydration
  // completes. Fall back to store, then to 'builtin' only when truly unknown.
  const harness = params.harness ?? subChat?.harness ?? 'builtin';

  // Resolve the workspace CWD for CLI harnesses. Prefer worktreePath (git
  // worktree), fall back to the project root. Only queried for CLI panels
  // to avoid an unnecessary round-trip for builtin subChats.
  const isCliHarnessEarly = harness === 'claude-cli' || harness === 'codex-cli';
  const { data: chatData, isLoading: chatDataLoading } = trpc.chats.get.useQuery(
    { id: params.chatId },
    { enabled: isCliHarnessEarly, staleTime: Infinity }
  );
  const cliCwd = chatData?.worktreePath ?? chatData?.project?.path ?? subChat?.cwd;
  // Gate bootstrap until the cwd query resolves so the CLI starts in the correct dir.
  const cliCwdReady = !isCliHarnessEarly || !chatDataLoading;

  // Dockview can restore a panel as the active tab without emitting the
  // visibility/active events to an already-mounted custom panel component.
  // Re-read the panel API on layout changes and on the next frame so a
  // restored workspace does not show a blank active chat until the user
  // clicks another tab.
  useEffect(() => {
    const syncPanelState = () => {
      setIsVisible(api.isVisible);
      setIsActive(api.isActive);
    };
    syncPanelState();
    const frame = requestAnimationFrame(syncPanelState);
    const subVisibility = api.onDidVisibilityChange((e) => setIsVisible(e.isVisible));
    const subActive = api.onDidActiveChange((e) => setIsActive(e.isActive));
    const subLayout = containerApi.onDidLayoutChange(syncPanelState);
    return () => {
      cancelAnimationFrame(frame);
      subVisibility.dispose();
      subActive.dispose();
      subLayout.dispose();
    };
  }, [api, containerApi]);

  // When this panel becomes the active panel in its dockview, sync
  // `activeSubChatId` so the rest of the app (right-rail widgets,
  // /commands, hotkeys) treats this sub-chat as the focused one.
  //
  // Multi-workspace caveat: every visited workspace has its own
  // WorkspaceDockShell mounted, so multiple ChatPanels (one per
  // workspace) can have `api.isActive=true` simultaneously — each
  // dockview has its own focused panel. Without the workspace gate,
  // they'd race to write the global `activeSubChatId`. Only the
  // currently-selected workspace's chat panels should claim focus.
  //
  // The workspace id check still reads `selectedAgentChatIdAtom` via
  // `appStore.get` instead of `useAtomValue`; workspace visibility is
  // delivered by WorkspaceDockShell context, while the selected-id read
  // remains a fire-time guard against stale panel events.
  useEffect(() => {
    if (!isWorkspaceActive || !isActive) return;
    const selectedWorkspaceId = appStore.get(selectedAgentChatIdAtom);
    if (params.chatId !== selectedWorkspaceId) return;
    setActiveSubChat(params.subChatId);
  }, [isWorkspaceActive, isActive, params.chatId, params.subChatId, setActiveSubChat]);

  // Keep the dockview tab title in sync with the sub-chat's display name.
  // Wait for store hydration before pushing a title so we don't overwrite
  // the restored dock snapshot title with a stale creation-time placeholder.
  useEffect(() => {
    if (!subChat) return;
    const nextTitle = subChat.name || 'New Chat';
    if (nextTitle !== api.title) {
      api.setTitle(nextTitle);
    }
  }, [subChat, api]);

  const isCliHarness = isCliHarnessEarly;

  useEffect(() => {
    console.log(
      `[chat-panel] mount subChat=${params.subChatId} params.harness=${params.harness ?? '(none)'} resolved=${harness}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isCliHarnessEarly) return;
    console.log(
      `[chat-panel] cwd-trace subChat=${params.subChatId} chatDataLoading=${chatDataLoading} worktreePath=${chatData?.worktreePath ?? '(none)'} projectPath=${chatData?.project?.path ?? '(none)'} subChat.cwd=${subChat?.cwd ?? '(none)'} cliCwd=${cliCwd ?? '(none)'} cliCwdReady=${cliCwdReady}`
    );
  }, [
    isCliHarnessEarly,
    chatDataLoading,
    chatData?.worktreePath,
    chatData?.project?.path,
    subChat?.cwd,
    cliCwd,
    cliCwdReady,
    params.subChatId
  ]);

  // Stuck-session detection for builtin harness (heuristic 4: stream silence >120s)
  useStuckDetection({ subChatId: params.subChatId, harness });

  const hardResetHandlerAtom = useMemo(() => subChatHardResetHandlerAtomFamily(params.subChatId), [params.subChatId]);
  const setHardResetHandler = useSetAtom(hardResetHandlerAtom);

  const handleBuiltinHardReset = useCallback(async () => {
    console.log(`[resilience] subChat=${params.subChatId} event=hard-reset`);
    agentChatStore.setManuallyAborted(params.subChatId, true);
    if (stopHandler) {
      try {
        await stopHandler();
      } catch {
        // Ignore; stream may already be idle
      }
    }
    setBuiltinRemountKey((k) => k + 1);
  }, [params.subChatId, stopHandler]);

  // Register hard-reset handler for builtin harness so ChatInputArea can render the button.
  useEffect(() => {
    if (isCliHarness) return;
    setHardResetHandler(() => handleBuiltinHardReset);
    return () => setHardResetHandler(null);
  }, [isCliHarness, setHardResetHandler, handleBuiltinHardReset]);

  // Mount AgentsContent for any visible panel (active tab in its group).
  // Hidden tabs (in the same group, not selected) render nothing. Across
  // groups every visible panel mounts independently, so a horizontal split
  // shows two chats side-by-side.
  const isStoreActivePanel =
    isWorkspaceActive &&
    (activeSubChatId === params.subChatId || (!activeSubChatId && openSubChatIds[0] === params.subChatId));
  const shouldMountContent = isVisible || isStoreActivePanel;

  // Surface router — 6-cell table from specs/chat-surface-router/spec.md:
  //
  //   harness      | openspecChangeId | Main surface
  //   -------------|------------------|--------------------------------------------
  //   builtin      | null             | Classic messages (AgentsContent)
  //   builtin      | <id>             | OpenSpec editor + AgentsContent sidebar
  //   claude-cli   | null             | Embedded terminal (claude CLI)
  //   claude-cli   | <id>             | OpenSpec editor + terminal sidebar
  //   codex-cli    | null             | Embedded terminal (codex CLI)
  //   codex-cli    | <id>             | OpenSpec editor + terminal sidebar
  //
  // Sidebars and the bottom prompt input live outside this switch.
  const nonOwnerBanner = !isOwner ? (
    <div
      data-testid="non-owner-banner"
      className="flex items-center justify-between gap-2 px-3 py-1.5 bg-muted border-b border-border text-xs text-muted-foreground flex-shrink-0">
      <span>Already open in another window — actions are read-only here</span>
      <button
        data-testid="non-owner-take-over"
        onClick={takeOver}
        className="text-xs underline hover:text-foreground transition-colors">
        Take over here
      </button>
    </div>
  ) : null;

  if (openspecChangeId && openspecProjectId && openspecChangePath) {
    // OpenSpec editor (main area) — sidebar varies by harness
    const sidebarContent = isCliHarness ? (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatCliSurface
            subChatId={params.subChatId}
            harness={harness}
            chatId={params.chatId}
            cwd={cliCwd}
            cwdReady={cliCwdReady}
            shouldMountContent={shouldMountContent}
            isOwner={isOwner}
          />
        </div>
        <CliPromptBar subChatId={params.subChatId} isOwner={isOwner} harness={harness} />
      </div>
    ) : undefined; // undefined → OpenSpecChangePanelContent renders AgentsContent

    return (
      <div className="h-full w-full flex flex-col overflow-hidden">
        {nonOwnerBanner}
        <OpenSpecChangePanelContent
          params={{
            subChatId: params.subChatId,
            chatId: params.chatId,
            projectId: openspecProjectId,
            changeId: openspecChangeId,
            changePath: openspecChangePath,
            name: subChat?.name ?? params.name
          }}
          isWorkspaceActive={isWorkspaceActive}
          shouldMountContent={shouldMountContent}
          isActivePanel={isActive || isStoreActivePanel}
          sidebarContent={sidebarContent}
        />
      </div>
    );
  }

  if (isCliHarness) {
    // CLI harness, no openspec change — full-panel terminal + prompt bar
    return (
      <div
        className="h-full w-full overflow-hidden bg-background border-t border-border flex flex-col"
        style={{ contain: 'layout style' }}>
        {nonOwnerBanner}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatCliSurface
            subChatId={params.subChatId}
            harness={harness}
            chatId={params.chatId}
            cwd={cliCwd}
            cwdReady={cliCwdReady}
            shouldMountContent={shouldMountContent}
            isOwner={isOwner}
          />
        </div>
        <CliPromptBar subChatId={params.subChatId} isOwner={isOwner} harness={harness} />
      </div>
    );
  }

  // Default: builtin harness, no openspec change — classic messages
  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden bg-background border-t border-border"
      style={{
        contain: 'layout style paint'
      }}>
      {nonOwnerBanner}
      {shouldMountContent ? (
        <AgentsContent
          key={builtinRemountKey}
          subChatIdOverride={params.subChatId}
          dockWorkspaceActive={isWorkspaceActive}
          dockPanelVisible={shouldMountContent}
          dockPanelActive={isActive || isStoreActivePanel}
        />
      ) : null}
    </div>
  );
}
