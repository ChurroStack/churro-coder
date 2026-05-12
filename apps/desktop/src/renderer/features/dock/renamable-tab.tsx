import { forwardRef, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  X,
  MessageSquare,
  SquareTerminal,
  FileText,
  GitCompare,
  Search,
  FolderTree,
  Loader2,
  Hand,
  AlertCircle,
  type LucideIcon
} from 'lucide-react';
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { useSetAtom } from 'jotai';
import { trpc } from '../../lib/trpc';
import { useAgentSubChatStore } from '../agents/stores/sub-chat-store';
import { terminalsAtom } from '../terminal/atoms';
import { cn } from '../../lib/utils';
import { getFileIconByExtension } from '../agents/mentions/agents-file-mention';
import { requestArchiveChatTab } from './chat-tab-archive';
import { requestCloseTerminalTab } from './terminal-tab-close';
import { useStreamingStatusStore } from '../agents/stores/streaming-status-store';
import { useSubChatNeedsInput } from '../kanban/lib/use-sub-chat-status';

/**
 * Default dockview tab component used by every panel kind. The body renders
 * the panel title (read live from `api.title`); double-clicking enters
 * inline-edit mode and Enter / blur saves through a per-kind dispatcher.
 *
 * - `chat:${subChatId}` → trpc updateSubChatName (which updates allSubChats
 *   in the store; the ChatPanel useEffect picks up the new name and calls
 *   api.setTitle).
 * - `terminal:${paneId}` → directly mutates the terminalsAtom entry; the
 *   TerminalPanel useEffect propagates the new name to api.setTitle.
 *
 * Other panel kinds (file / plan / diff / search / files-tree / main) just
 * use the read-only path — double-click is a no-op.
 */
export function RenamableTab(props: IDockviewPanelHeaderProps) {
  const { api, containerApi } = props;
  const chatSubChatId = api.id.startsWith('chat:') ? api.id.slice('chat:'.length) : null;
  const storeChatTitle = useAgentSubChatStore((s) =>
    chatSubChatId ? (s.allSubChats.find((sc) => sc.id === chatSubChatId)?.name ?? null) : null
  );
  const [title, setTitle] = useState(api.title ?? '');
  const [isActive, setIsActive] = useState(api.isActive);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [conversationPanelCount, setConversationPanelCount] = useState(() =>
    countConversationPanels(containerApi.panels)
  );
  const [totalPanelCount, setTotalPanelCount] = useState(() => containerApi.panels.length);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local title in sync with whatever the panel pushes via setTitle.
  useEffect(() => {
    const syncTitle = () => setTitle(api.title ?? '');
    syncTitle();
    const subTitle = api.onDidTitleChange((e) => setTitle(e.title ?? ''));
    // Dockview may update header state during activation/layout without
    // delivering a title event to an already-mounted custom tab component.
    const subLayout = containerApi.onDidLayoutChange(syncTitle);
    return () => {
      subTitle.dispose();
      subLayout.dispose();
    };
  }, [api, containerApi]);

  const resolvedTitle = resolveChatTabTitle(storeChatTitle, title);

  useEffect(() => {
    if (!resolvedTitle) return;
    if (title !== resolvedTitle) setTitle(resolvedTitle);
    if (api.title !== resolvedTitle) api.setTitle(resolvedTitle);
  }, [api, resolvedTitle, title]);

  useEffect(() => {
    setIsActive(api.isActive);
    const sub = api.onDidActiveChange((e) => setIsActive(e.isActive));
    return () => sub.dispose();
  }, [api]);

  // Track the conversation-panel count so the close X on the *last* chat or
  // OpenSpec editor can be disabled. Also track the total panel count so the
  // close X on the *only* tab (any kind) is disabled — closing the last
  // panel would leave dockview empty.
  useEffect(() => {
    const recount = () => {
      setConversationPanelCount(countConversationPanels(containerApi.panels));
      setTotalPanelCount(containerApi.panels.length);
    };
    recount();
    const subAdd = containerApi.onDidAddPanel(recount);
    const subRem = containerApi.onDidRemovePanel(recount);
    return () => {
      subAdd.dispose();
      subRem.dispose();
    };
  }, [containerApi]);

  const displayTitle = resolvedTitle || title;

  useEffect(() => {
    if (editing) {
      setDraft(displayTitle);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, displayTitle]);

  const kind = panelKind(api.id);
  // Disable the close X in two cases:
  // 1. The last chat/OpenSpec tab — there must always be at least one
  //    conversation surface open per workspace.
  // 2. The only tab in dockview, of any kind. Closing it would leave the
  //    center cell empty.
  const isConversationPanel = api.id.startsWith('chat:') || api.id.startsWith('openspec-change:');
  const isLastConversation = isConversationPanel && conversationPanelCount <= 1;
  const isOnlyPanel = totalPanelCount <= 1;
  const closeDisabled = isLastConversation || isOnlyPanel;

  const startEdit = () => {
    if (!kind) return;
    setDraft(displayTitle);
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);

  return (
    <div
      className={cn(
        'h-full flex items-center gap-1 px-2 select-none cursor-pointer',
        'text-xs',
        isActive ? 'text-foreground' : 'text-muted-foreground'
      )}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        startEdit();
      }}>
      <TabIcon panelId={api.id} title={displayTitle} />
      {editing ? (
        <RenameInput
          ref={inputRef}
          value={draft}
          onChange={setDraft}
          onCancel={cancelEdit}
          onSave={async (next) => {
            const trimmed = next.trim();
            setEditing(false);
            if (!trimmed || trimmed === displayTitle) return;
            await dispatchRename(api.id, trimmed);
          }}
        />
      ) : (
        <span className="truncate max-w-[260px]" title={displayTitle}>
          {displayTitle || 'Untitled'}
        </span>
      )}
      <button
        type="button"
        aria-label={
          closeDisabled
            ? isLastConversation
              ? 'Cannot close last chat or OpenSpec editor'
              : 'Cannot close last tab'
            : 'Close tab'
        }
        title={
          isLastConversation
            ? 'At least one chat or OpenSpec editor must stay open'
            : isOnlyPanel
              ? 'At least one tab must stay open'
              : undefined
        }
        disabled={closeDisabled}
        onClick={(e) => {
          e.stopPropagation();
          // Chat tabs go through the archive flow. OpenSpec panels close
          // directly and DockShell mirrors that into openSubChatIds.
          if (closeDisabled) return;
          if (kind === 'chat') {
            requestArchiveChatTab(api.id);
            return;
          }
          if (kind === 'terminal') {
            requestCloseTerminalTab(api.id);
            return;
          }
          api.close();
        }}
        className={cn(
          'rounded flex items-center justify-center transition-opacity',
          closeDisabled ? 'opacity-20 cursor-not-allowed' : 'opacity-50 hover:opacity-100 hover:bg-foreground/10'
        )}
        style={{ width: 14, height: 14 }}>
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function countConversationPanels(panels: { id: string }[]): number {
  let n = 0;
  for (const p of panels) {
    if (p.id.startsWith('chat:') || p.id.startsWith('openspec-change:')) n++;
  }
  return n;
}

function resolveChatTabTitle(storeTitle: string | null, currentTitle: string): string | null {
  if (!storeTitle) return null;
  if (storeTitle !== 'New Chat') return storeTitle;
  // A placeholder from an orphan/open-id fallback should not clobber a real
  // title restored from dockview. For genuinely unnamed chats, both sides
  // are already placeholders and displaying "New Chat" is correct.
  if (!currentTitle || currentTitle === 'Untitled' || currentTitle === 'Conversation' || currentTitle === 'New Chat') {
    return storeTitle;
  }
  return null;
}

/**
 * Single-purpose hook target for the rename input. We split this out so the
 * trpc + atom hooks are only instantiated once at the component root, not on
 * every keystroke inside the input itself.
 */
function useRenameDispatcher() {
  const renameSubChat = trpc.chats.renameSubChat.useMutation();
  const setTerminals = useSetAtom(terminalsAtom);

  return async (panelId: string, nextName: string) => {
    const kind = panelKind(panelId);
    if (kind === 'chat') {
      const subChatId = panelId.slice('chat:'.length);
      // Optimistic store update so the dockview tab title flips before the
      // mutation round-trips. The store is the source of truth for ChatPanel's
      // title sync useEffect.
      const store = useAgentSubChatStore.getState();
      store.updateSubChatName(subChatId, nextName);
      try {
        await renameSubChat.mutateAsync({ id: subChatId, name: nextName });
      } catch (err) {
        console.warn('[rename] sub-chat rename failed:', err);
      }
      return;
    }
    if (kind === 'terminal') {
      const paneId = panelId.slice('terminal:'.length);
      setTerminals((prev) => {
        const next: typeof prev = {};
        for (const chatId of Object.keys(prev)) {
          next[chatId] = prev[chatId].map((t) => (t.paneId === paneId ? { ...t, name: nextName } : t));
        }
        return next;
      });
      return;
    }
    // Other kinds aren't user-renamable — no-op.
  };
}

let dispatchRenameImpl: ((panelId: string, name: string) => Promise<void>) | null = null;

/**
 * The dispatcher needs trpc / setAtom hooks, but the tab component is rendered
 * by dockview which sits outside React's normal mount tree (it's a headless
 * tab). We wire the dispatcher up via a tiny "host" component mounted inside
 * AgentsLayout so the tab can call dispatchRename without prop drilling.
 */
export function RenameDispatchHost() {
  const dispatch = useRenameDispatcher();
  // Capture the latest dispatch function in the module-level slot so the
  // RenamableTab (which has no React context to consume) can reach it.
  useEffect(() => {
    dispatchRenameImpl = dispatch;
    return () => {
      dispatchRenameImpl = null;
    };
  }, [dispatch]);
  return null;
}

async function dispatchRename(panelId: string, nextName: string): Promise<void> {
  if (dispatchRenameImpl) await dispatchRenameImpl(panelId, nextName);
}

function panelKind(panelId: string): 'chat' | 'terminal' | null {
  if (panelId.startsWith('chat:')) return 'chat';
  if (panelId.startsWith('terminal:')) return 'terminal';
  return null;
}

function ChatTabIcon({ subChatId }: { subChatId: string | null }) {
  const status = useStreamingStatusStore((s) => (subChatId ? (s.statuses[subChatId] ?? 'ready') : 'ready'));
  const needsInput = useSubChatNeedsInput(subChatId);

  if (status === 'error') {
    return <AlertCircle className="h-3 w-3 flex-shrink-0 text-destructive" />;
  }
  if (needsInput) {
    return <Hand className="h-3 w-3 flex-shrink-0 text-amber-500" />;
  }
  if (status === 'streaming' || status === 'submitted') {
    return <Loader2 className="h-3 w-3 flex-shrink-0 text-primary animate-spin" />;
  }
  return <MessageSquare className="h-3 w-3 flex-shrink-0 opacity-70" />;
}

/**
 * Renders the leading icon of a dockview tab. Each panel kind gets a small
 * lucide-react glyph; file panels use the same per-extension icon set the
 * file mention picker uses, picked from the absolute path embedded in the
 * panel id (`file:${absolutePath}`). Unknown kinds render nothing — the
 * tab still has its title.
 */
function TabIcon({ panelId, title }: { panelId: string; title: string }) {
  if (panelId.startsWith('chat:')) {
    return <ChatTabIcon subChatId={panelId.slice('chat:'.length)} />;
  }
  if (panelId === 'main') {
    return <ChatTabIcon subChatId={null} />;
  }
  if (panelId.startsWith('chat-new:')) {
    return <MessageSquare className="h-3 w-3 flex-shrink-0 opacity-70" />;
  }
  if (panelId.startsWith('terminal:')) {
    return <SquareTerminal className="h-3 w-3 flex-shrink-0 opacity-70" />;
  }
  if (panelId.startsWith('plan:')) {
    return <FileText className="h-3 w-3 flex-shrink-0 opacity-70" />;
  }
  if (panelId.startsWith('diff:')) {
    return <GitCompare className="h-3 w-3 flex-shrink-0 opacity-70" />;
  }
  if (panelId.startsWith('search:')) {
    return <Search className="h-3 w-3 flex-shrink-0 opacity-70" />;
  }
  if (panelId.startsWith('files-tree:')) {
    return <FolderTree className="h-3 w-3 flex-shrink-0 opacity-70" />;
  }
  if (panelId.startsWith('file:')) {
    // The id encodes the absolute path; the title is the basename. Either
    // works for getFileIconByExtension — prefer the basename for short paths.
    const fileNameForLookup = title || panelId.slice('file:'.length);
    const Icon = getFileIconByExtension(fileNameForLookup) as ComponentType<{ className?: string }> | LucideIcon | null;
    if (!Icon) return null;
    return <Icon className="h-3 w-3 flex-shrink-0" />;
  }
  return null;
}

interface RenameInputProps {
  value: string;
  onChange: (next: string) => void;
  onSave: (final: string) => void;
  onCancel: () => void;
}

const RenameInput = forwardRef<HTMLInputElement, RenameInputProps>(function RenameInput(
  { value, onChange, onSave, onCancel },
  ref
) {
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onSave(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSave(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
        // Don't bubble — dockview consumes Backspace etc. otherwise.
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="h-5 w-[140px] px-1 rounded border border-input bg-background text-xs outline-none focus:ring-1 focus:ring-primary/50"
    />
  );
});
