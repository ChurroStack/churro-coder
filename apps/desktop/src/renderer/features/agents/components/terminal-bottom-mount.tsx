'use client';

import { ResizableBottomPanel } from '../../../components/ui/resizable-bottom-panel';
import { TerminalBottomPanelContent } from '../../terminal/terminal-sidebar';
import { terminalBottomHeightAtom } from '../../terminal/atoms';

export interface TerminalBottomMountProps {
  /**
   * Render the bottom panel only when `displayMode === "bottom"`. The renderer
   * passes the current display-mode value; the component renders null otherwise.
   * Accepts the broader "side-peek" / "bottom" union (matches `TerminalDisplayMode`).
   */
  displayMode: 'side-peek' | 'bottom';
  worktreePath: string | null;
  isOpen: boolean;
  isMobileFullscreen: boolean;
  chatId: string;
  terminalScopeKey: string;
  toggleTerminalHotkey?: string;
  onClose: () => void;
}

/**
 * Bottom-panel mount for the terminal. Wraps `TerminalBottomPanelContent` in
 * a `ResizableBottomPanel` and gates render on display-mode + worktree
 * availability + mobile-fullscreen flag.
 *
 * Extracted from `active-chat.tsx` (Phase 3). The component takes only the
 * props it needs; no closure into the renderer's state.
 */
export function TerminalBottomMount({
  displayMode,
  worktreePath,
  isOpen,
  isMobileFullscreen,
  chatId,
  terminalScopeKey,
  toggleTerminalHotkey,
  onClose
}: TerminalBottomMountProps) {
  if (displayMode !== 'bottom' || !worktreePath || isMobileFullscreen) {
    return null;
  }
  return (
    <ResizableBottomPanel
      isOpen={isOpen}
      onClose={onClose}
      heightAtom={terminalBottomHeightAtom}
      minHeight={150}
      maxHeight={500}
      showResizeTooltip
      closeHotkey={toggleTerminalHotkey}
      className="bg-background border-t"
      style={{ borderTopWidth: '0.5px' }}>
      <TerminalBottomPanelContent
        chatId={chatId}
        scopeKey={terminalScopeKey}
        cwd={worktreePath}
        workspaceId={chatId}
        onClose={onClose}
      />
    </ResizableBottomPanel>
  );
}
