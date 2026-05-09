import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useAtom, useAtomValue } from 'jotai';
import { useAgentSubChatStore } from '../../agents/stores/sub-chat-store';
import { selectedAgentChatIdAtom } from '../../agents/atoms';
import { appStore } from '../../../lib/jotai-store';
import { AgentsContent } from '../../agents/ui/agents-content';
import { OpenSpecChangeView } from '../../openspec/openspec-change-view';
import { openSpecChangeChatWidthAtom } from '../../openspec/atoms';
import { useDockWorkspace } from '../workspace-context';
import type { OpenSpecChangePanelEntity } from '../atoms';

const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 560;

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

  const [chatWidth, setChatWidth] = useAtom(openSpecChangeChatWidthAtom);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

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
      <div className="h-full overflow-hidden">
        <OpenSpecChangeView changeId={params.changeId} projectId={params.projectId} />
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
          dockPanelActive={isActive || isStoreActivePanel}
          chrome="embedded"
        />
      </div>
    </div>
  );
}
