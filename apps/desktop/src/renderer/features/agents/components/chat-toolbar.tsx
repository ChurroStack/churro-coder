'use client';

import { cn } from '../../../lib/utils';
import { ChatTitleEditor } from '../ui/chat-title-editor';
import { SplitPaneInlineClose } from './split-pane-inline-close';

export interface ChatToolbarProps {
  /** Hide entirely on mobile (a `MobileChatHeader` renders elsewhere instead). */
  isMobile: boolean;
  /** Adds top padding to clear the open sub-chats sidebar's traffic-light spacer. */
  isSubChatsSidebarOpen: boolean;
  /** Whether this chat is rendered as one of multiple split panes (shows the close-pane X). */
  isSplitPane: boolean;
  subChatId: string;
  subChatName: string;
  workspaceRepoName: string | null;
  workspaceBranch: string | null;
  /**
   * Called when the user renames the sub-chat via the title editor. The
   * renderer's `handleRenameSubChat` is async (rename mutation), and
   * `ChatTitleEditor.onSave` requires `Promise<void>` — so this prop is
   * typed strictly as a Promise-returning function.
   */
  onRenameSubChat: (newName: string) => Promise<void>;
}

/**
 * Title row + workspace subtitle for the chat header.
 *
 * Renders the editable title, the per-pane close X (for split panes), and the
 * `repo • branch` subtitle. Returns null on mobile — the caller renders
 * `MobileChatHeader` instead.
 *
 * Extracted from `active-chat.tsx` (Phase 3).
 */
export function ChatToolbar({
  isMobile,
  isSubChatsSidebarOpen,
  isSplitPane,
  subChatId,
  subChatName,
  workspaceRepoName,
  workspaceBranch,
  onRenameSubChat
}: ChatToolbarProps) {
  if (isMobile) return null;

  return (
    <div className={cn('flex-shrink-0 pb-2', isSubChatsSidebarOpen ? 'pt-[52px]' : 'pt-2')}>
      <div className="flex items-center">
        <div className="flex-1 min-w-0">
          <ChatTitleEditor
            name={subChatName}
            placeholder="New Chat"
            onSave={onRenameSubChat}
            isMobile={false}
            chatId={subChatId}
            hasMessages={true} /* Always show "New Chat" placeholder when name is empty */
          />
        </div>
        {isSplitPane && <SplitPaneInlineClose subChatId={subChatId} />}
      </div>
      {(workspaceRepoName || workspaceBranch) && (
        <div className="max-w-5xl mx-auto px-2">
          <span className="text-xs text-muted-foreground/50 truncate block">
            {[workspaceRepoName, workspaceBranch].filter(Boolean).join(' • ')}
          </span>
        </div>
      )}
    </div>
  );
}
