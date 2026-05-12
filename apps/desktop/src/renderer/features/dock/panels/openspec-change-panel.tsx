import { useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useAtom, useSetAtom } from 'jotai';
import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { selectedAgentChatIdAtom } from '../../agents/atoms';
import { appStore } from '../../../lib/jotai-store';
import { AgentsContent } from '../../agents/ui/agents-content';
import { OpenSpecChangeView } from '../../openspec/openspec-change-view';
import { OpenspecSkillsBanner } from '../../openspec/openspec-skills-banner';
import { openSpecChangeChatWidthAtom, openSpecSidebarContextAtomFamily } from '../../openspec/atoms';
import { useDockWorkspace } from '../workspace-context';
import type { OpenSpecChangePanelEntity } from '../atoms';

const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 560;

interface OpenSpecChangePanelContentProps {
  params: OpenSpecChangePanelEntity;
  isWorkspaceActive: boolean;
  shouldMountContent: boolean;
  isActivePanel: boolean;
}

/**
 * OpenSpecChangePanel — dockview tab that displays an OpenSpec change.
 *
 * Layout: left pane (1fr, content centered at `max-w-5xl`) = read-only spec
 * viewer; right pane (`chatWidth` px, resizable, persisted via
 * `openSpecChangeChatWidthAtom`) = embedded chat sidebar. The two panes are
 * separated by a 6px transparent drag handle.
 */
export function OpenSpecChangePanel({ params, api, containerApi }: IDockviewPanelProps<OpenSpecChangePanelEntity>) {
  const [isVisible, setIsVisible] = useState(api.isVisible);
  const [isActive, setIsActive] = useState(api.isActive);
  const { active: isWorkspaceActive } = useDockWorkspace();
  const setActiveSubChat = useAgentSubChatStore((s) => s.setActiveSubChat);
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId);
  const openSubChatIds = useAgentSubChatStore((s) => s.openSubChatIds);
  const allSubChats = useAgentSubChatStore((s) => s.allSubChats);

  // Sync dockview visibility/active state
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

  // Push activeSubChatId when this panel is focused (same guard as ChatPanel)
  useEffect(() => {
    if (!isWorkspaceActive || !isActive) return;
    const selectedWorkspaceId = appStore.get(selectedAgentChatIdAtom);
    if (params.chatId !== selectedWorkspaceId) return;
    setActiveSubChat(params.subChatId);
  }, [isWorkspaceActive, isActive, params.chatId, params.subChatId, setActiveSubChat]);

  // Keep tab title in sync with sub-chat name
  useEffect(() => {
    const sc = allSubChats.find((x) => x.id === params.subChatId);
    if (!sc) return;
    const nextTitle = sc.name || params.name || params.changeId;
    if (nextTitle !== api.title) api.setTitle(nextTitle);
  }, [allSubChats, params.subChatId, params.name, params.changeId, api]);

  const isStoreActivePanel =
    isWorkspaceActive &&
    (activeSubChatId === params.subChatId || (!activeSubChatId && openSubChatIds[0] === params.subChatId));
  const shouldMountContent = isVisible || isStoreActivePanel;

  return (
    <OpenSpecChangePanelContent
      params={params}
      isWorkspaceActive={isWorkspaceActive}
      shouldMountContent={shouldMountContent}
      isActivePanel={isActive || isStoreActivePanel}
    />
  );
}

export function OpenSpecChangePanelContent({
  params,
  isWorkspaceActive,
  shouldMountContent,
  isActivePanel
}: OpenSpecChangePanelContentProps) {
  const [chatWidth, setChatWidth] = useAtom(openSpecChangeChatWidthAtom);
  const sidebarContextAtom = useMemo(() => openSpecSidebarContextAtomFamily(params.subChatId), [params.subChatId]);
  const setSidebarContext = useSetAtom(sidebarContextAtom);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    setSidebarContext({
      chatId: params.chatId,
      projectId: params.projectId,
      changeId: params.changeId,
      changePath: params.changePath
    });
    return () => setSidebarContext(null);
  }, [params.changeId, params.changePath, params.chatId, params.projectId, setSidebarContext]);

  // Resizer pointer handlers
  const handleResizerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = chatWidth;
  };

  const handleResizerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const delta = dragStartX.current - e.clientX; // dragging left = wider chat
    const next = Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, dragStartWidth.current + delta));
    setChatWidth(next);
  };

  const handleResizerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    isDragging.current = false;
  };

  if (!shouldMountContent) return null;

  return (
    <div
      className="h-full w-full overflow-hidden bg-background border-t border-border"
      style={{ display: 'grid', gridTemplateColumns: `1fr 6px ${chatWidth}px` }}>
      {/* Left pane: spec viewer */}
      <div className="h-full overflow-hidden flex flex-col">
        <div className="px-4 pt-3">
          <OpenspecSkillsBanner chatId={params.chatId} />
        </div>
        <div className="flex-1 overflow-hidden">
          <OpenSpecChangeView
            chatId={params.chatId}
            subChatId={params.subChatId}
            changeId={params.changeId}
            changePath={params.changePath}
            projectId={params.projectId}
          />
        </div>
      </div>

      {/* Resizer gutter — transparent, just provides the drag target */}
      <div
        className="h-full cursor-col-resize select-none"
        onPointerDown={handleResizerPointerDown}
        onPointerMove={handleResizerPointerMove}
        onPointerUp={handleResizerPointerUp}
      />

      {/* Right pane: embedded chat */}
      <div className="h-full overflow-hidden border-l border-border">
        <AgentsContent
          subChatIdOverride={params.subChatId}
          dockWorkspaceActive={isWorkspaceActive}
          dockPanelVisible={shouldMountContent}
          dockPanelActive={isActivePanel}
          chrome="embedded"
        />
      </div>
    </div>
  );
}
