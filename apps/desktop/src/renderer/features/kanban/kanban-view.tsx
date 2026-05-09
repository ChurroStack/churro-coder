import { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc';
import { getWindowId } from '../../contexts/WindowContext';
import {
  selectedAgentChatIdAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
  loadingSubChatsAtom,
  pendingUserQuestionsAtom,
  expiredUserQuestionsAtom,
  pendingPlanApprovalsAtom,
  agentsUnseenChangesAtom,
  selectedProjectAtom,
  agentsSidebarOpenAtom
} from '../agents/atoms';
import { selectedAgentChatIdsAtom, isAgentMultiSelectModeAtom, toggleAgentChatSelectionAtom } from '../../lib/atoms';
import { KanbanBoard } from './components/kanban-board';
import type { KanbanCardData } from './components/kanban-card';
import { deriveKanbanStatus, deriveAttentionReason, pickLatestActiveSubChat } from './lib/kanban-state-machine';
import { useNewChatDrafts } from '../agents/lib/drafts';
import { exportChat, copyChat } from '../agents/lib/export-chat';
import { AgentsRenameSubChatDialog } from '../agents/components/agents-rename-subchat-dialog';
import { ConfirmArchiveDialog } from '../../components/confirm-archive-dialog';
import { AgentsHeaderControls } from '../agents/ui/agents-header-controls';
import { Input } from '../../components/ui/input';
import { Search } from 'lucide-react';

// Event for open sub-chats changes
const OPEN_SUB_CHATS_CHANGE_EVENT = 'open-sub-chats-change';

// Track which chatIds have already been logged as in-review this session
const loggedInReviewIds = new Set<string>();

export function KanbanView() {
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom);
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom);

  // Sidebar state for header controls
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom);

  // Multi-select state
  const [selectedChatIds] = useAtom(selectedAgentChatIdsAtom);
  const isMultiSelectMode = useAtomValue(isAgentMultiSelectModeAtom);
  const toggleChatSelection = useSetAtom(toggleAgentChatSelectionAtom);

  // Status atoms
  const loadingSubChats = useAtomValue(loadingSubChatsAtom);
  const pendingQuestions = useAtomValue(pendingUserQuestionsAtom);
  const expiredQuestions = useAtomValue(expiredUserQuestionsAtom);
  const pendingPlanApprovals = useAtomValue(pendingPlanApprovalsAtom);
  const unseenChanges = useAtomValue(agentsUnseenChangesAtom);

  // Project for pinned chats storage
  const [selectedProject] = useAtom(selectedProjectAtom);

  // Pinned chats (stored in localStorage per project)
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());

  // Search query
  const [searchQuery, setSearchQuery] = useState('');

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingChat, setRenamingChat] = useState<{ id: string; name: string | null } | null>(null);

  // Archive confirmation dialog state
  const [confirmArchiveDialogOpen, setConfirmArchiveDialogOpen] = useState(false);
  const [archivingChatId, setArchivingChatId] = useState<string | null>(null);
  const [activeProcessCount, setActiveProcessCount] = useState(0);

  // tRPC utils
  const utils = trpc.useUtils();

  // Load pinned IDs from localStorage when project changes
  useEffect(() => {
    if (!selectedProject?.id) {
      setPinnedChatIds(new Set());
      return;
    }
    try {
      const windowId = getWindowId();
      const stored = localStorage.getItem(`${windowId}:agent-pinned-chats-${selectedProject.id}`);
      setPinnedChatIds(stored ? new Set(JSON.parse(stored)) : new Set());
    } catch {
      setPinnedChatIds(new Set());
    }
  }, [selectedProject?.id]);

  // Save pinned IDs to localStorage when they change
  const prevPinnedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedProject?.id) return;
    if ((pinnedChatIds !== prevPinnedRef.current && pinnedChatIds.size > 0) || prevPinnedRef.current.size > 0) {
      const windowId = getWindowId();
      localStorage.setItem(`${windowId}:agent-pinned-chats-${selectedProject.id}`, JSON.stringify([...pinnedChatIds]));
    }
    prevPinnedRef.current = pinnedChatIds;
  }, [pinnedChatIds, selectedProject?.id]);

  // Toggle pin handler
  const handleTogglePin = useCallback((chatId: string) => {
    setPinnedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);

  // Drafts from localStorage (all drafts; state machine drops non-visible ones)
  const drafts = useNewChatDrafts();

  // Fetch all chats (workspaces)
  const { data: chats } = trpc.chats.list.useQuery({});

  // Fetch archived chats
  const { data: archivedChats } = trpc.chats.listArchived.useQuery({});

  // Fetch projects for metadata
  const { data: projects } = trpc.projects.list.useQuery();

  // Create projects map
  type Project = NonNullable<typeof projects>[number];
  const projectsMap = useMemo(() => {
    if (!Array.isArray(projects)) return new Map<string, Project>();
    return new Map(projects.map((p) => [p.id, p]));
  }, [projects]);

  // Track open sub-chat changes for reactivity
  const [openSubChatsVersion, setOpenSubChatsVersion] = useState(0);
  useEffect(() => {
    const handleChange = () => setOpenSubChatsVersion((v) => v + 1);
    window.addEventListener(OPEN_SUB_CHATS_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(OPEN_SUB_CHATS_CHANGE_EVENT, handleChange);
  }, []);

  // Store previous value to avoid unnecessary React Query refetches
  const prevOpenSubChatIdsRef = useRef<string[]>([]);

  // Collect all open sub-chat IDs from localStorage for all workspaces
  const allOpenSubChatIds = useMemo(() => {
    void openSubChatsVersion;
    const allChatsList = [
      ...(Array.isArray(chats) ? chats : []),
      ...(Array.isArray(archivedChats) ? archivedChats : [])
    ];
    if (allChatsList.length === 0) return prevOpenSubChatIdsRef.current;

    const windowId = getWindowId();
    const allIds: string[] = [];
    for (const chat of allChatsList) {
      try {
        const stored = localStorage.getItem(`${windowId}:agent-open-sub-chats-${chat.id}`);
        if (stored) {
          const ids = JSON.parse(stored) as string[];
          allIds.push(...ids);
        }
      } catch {
        // Skip invalid JSON
      }
    }

    const prev = prevOpenSubChatIdsRef.current;
    const sorted = [...allIds].sort();
    const prevSorted = [...prev].sort();
    if (sorted.length === prevSorted.length && sorted.every((id, i) => id === prevSorted[i])) {
      return prev;
    }

    prevOpenSubChatIdsRef.current = allIds;
    return allIds;
  }, [chats, archivedChats, openSubChatsVersion]);

  // Pending plan approvals from DB
  const { data: pendingPlanApprovalsData } = trpc.chats.getPendingPlanApprovals.useQuery(
    { openSubChatIds: allOpenSubChatIds },
    { refetchInterval: 5000, enabled: allOpenSubChatIds.length > 0, placeholderData: (prev) => prev }
  );

  // File stats from DB
  const { data: fileStatsData } = trpc.chats.getFileStats.useQuery(
    { openSubChatIds: allOpenSubChatIds },
    { refetchInterval: 5000, enabled: allOpenSubChatIds.length > 0, placeholderData: (prev) => prev }
  );

  // Build set of chatIds with pending plan approvals from DB
  const workspacesWithPendingApprovalsFromDb = useMemo(() => {
    const set = new Set<string>();
    if (pendingPlanApprovalsData) {
      for (const item of pendingPlanApprovalsData) {
        set.add(item.chatId);
      }
    }
    return set;
  }, [pendingPlanApprovalsData]);

  // Build set of chatIds with pending plan approvals (DB + runtime atom union)
  const workspacesWithPendingApprovals = useMemo(() => {
    const set = new Set<string>(workspacesWithPendingApprovalsFromDb);
    pendingPlanApprovals.forEach((parentChatId) => {
      set.add(parentChatId);
    });
    return set;
  }, [workspacesWithPendingApprovalsFromDb, pendingPlanApprovals]);

  // Build file stats map (chatId -> stats)
  const workspaceFileStats = useMemo(() => {
    const statsMap = new Map<string, { fileCount: number; additions: number; deletions: number }>();
    if (fileStatsData) {
      for (const stat of fileStatsData) {
        statsMap.set(stat.chatId, {
          fileCount: stat.fileCount,
          additions: stat.additions,
          deletions: stat.deletions
        });
      }
    }
    return statsMap;
  }, [fileStatsData]);

  // Build set of chatIds with pending questions (active + expired-but-still-answerable)
  const workspacesWithPendingQuestions = useMemo(() => {
    const set = new Set<string>();
    pendingQuestions.forEach((q) => {
      set.add(q.parentChatId);
    });
    expiredQuestions.forEach((q) => {
      set.add(q.parentChatId);
    });
    return set;
  }, [pendingQuestions, expiredQuestions]);

  // Build set of chatIds that are loading (from loadingSubChats values = parentChatIds)
  const workspacesLoading = useMemo(() => new Set([...loadingSubChats.values()]), [loadingSubChats]);

  // Build set of loading sub-chat IDs for pickLatestActiveSubChat
  const loadingSubChatIds = useMemo(() => new Set([...loadingSubChats.keys()]), [loadingSubChats]);

  // Attention signals passed to the state machine. unseenChanges is already a Set<string>,
  // so we pass it through directly.
  const attentionSignals = useMemo(
    () => ({
      workspacesWithPendingQuestions,
      workspacesWithPendingApprovals,
      workspacesWithUnseenChanges: unseenChanges
    }),
    [workspacesWithPendingQuestions, workspacesWithPendingApprovals, unseenChanges]
  );

  // Build kanban cards from workspaces (chats + archivedChats) + drafts
  const cards = useMemo(() => {
    const result: KanbanCardData[] = [];

    // Add drafts (state machine returns null for non-visible ones → drop the card)
    for (const draft of drafts) {
      const status = deriveKanbanStatus({ kind: 'draft', isVisible: draft.isVisible === true });
      if (status === null) continue;
      result.push({
        id: draft.id,
        name: draft.text.slice(0, 50) + (draft.text.length > 50 ? '...' : ''),
        chatId: draft.id,
        chatName: null,
        projectName: draft.project?.gitRepo || draft.project?.name || null,
        branch: null,
        mode: 'plan',
        status,
        attentionReason: null,
        hasUnseenChanges: false,
        hasPendingPlan: false,
        hasPendingQuestion: false,
        createdAt: new Date(draft.updatedAt),
        updatedAt: new Date(draft.updatedAt),
        isDraft: true,
        isPinned: false,
        isSelected: false
      });
    }

    // Add live chats + archived chats
    const allChatsList = [
      ...(Array.isArray(chats) ? chats : []),
      ...(Array.isArray(archivedChats) ? archivedChats : [])
    ];

    for (const chat of allChatsList) {
      const project = projectsMap.get(chat.projectId);

      // Pick the representative sub-chat for state derivation. mode is already narrowed
      // to 'plan' | 'execute' | 'explore' by the chats router boundary.
      const subChatRows = (chat.subChats ?? []).map((s) => ({
        id: s.id,
        mode: s.mode,
        updatedAt: s.updatedAt ?? new Date(0)
      }));
      const latestActiveSubChat = pickLatestActiveSubChat(subChatRows, loadingSubChatIds);
      const isLoading = workspacesLoading.has(chat.id);

      const input = {
        kind: 'chat' as const,
        chatId: chat.id,
        archivedAt: chat.archivedAt ?? null,
        prUrl: chat.prUrl ?? null,
        latestActiveSubChat,
        isLoading
      };

      const status = deriveKanbanStatus(input);
      if (status === null) continue;

      const attentionReason = deriveAttentionReason(input, attentionSignals);

      // Trace first observation of in-review per session (DEV only — keeps prod console clean)
      if (import.meta.env.DEV && status === 'in-review' && !loggedInReviewIds.has(chat.id)) {
        loggedInReviewIds.add(chat.id);
        console.debug('[kanban-state-machine] in-review chat=', chat.id, 'mode=', latestActiveSubChat?.mode);
      }

      result.push({
        id: chat.id,
        name: chat.name,
        chatId: chat.id,
        chatName: chat.name,
        projectName: project?.gitRepo || project?.name || null,
        branch: chat.branch,
        mode: latestActiveSubChat?.mode ?? 'plan',
        status,
        attentionReason,
        hasUnseenChanges: unseenChanges.has(chat.id),
        hasPendingPlan: workspacesWithPendingApprovals.has(chat.id),
        hasPendingQuestion: workspacesWithPendingQuestions.has(chat.id),
        createdAt: new Date(chat.createdAt || Date.now()),
        updatedAt: chat.updatedAt ? new Date(chat.updatedAt) : null,
        isDraft: false,
        stats: workspaceFileStats.get(chat.id),
        isPinned: pinnedChatIds.has(chat.id),
        isSelected: selectedChatIds.has(chat.id)
      });
    }

    // Apply search filter (matches name, chat name, project, or branch)
    const q = searchQuery.trim().toLowerCase();
    if (!q) return result;
    return result.filter(
      (c) =>
        (c.name ?? '').toLowerCase().includes(q) ||
        (c.chatName ?? '').toLowerCase().includes(q) ||
        (c.projectName ?? '').toLowerCase().includes(q) ||
        (c.branch ?? '').toLowerCase().includes(q)
    );
  }, [
    chats,
    archivedChats,
    drafts,
    projectsMap,
    loadingSubChatIds,
    workspacesLoading,
    attentionSignals,
    workspacesWithPendingApprovals,
    workspacesWithPendingQuestions,
    unseenChanges,
    workspaceFileStats,
    pinnedChatIds,
    selectedChatIds,
    searchQuery
  ]);

  // Navigation on card click
  const handleCardClick = useCallback(
    (card: KanbanCardData, e?: React.MouseEvent) => {
      // In multi-select mode with shift/cmd, toggle selection instead of navigating
      if (isMultiSelectMode || e?.shiftKey || e?.metaKey) {
        if (!card.isDraft) {
          toggleChatSelection(card.chatId);
        }
        return;
      }

      if (card.isDraft) {
        // Navigate to NewChatForm with this draft selected
        setSelectedChatId(null);
        setSelectedDraftId(card.id);
        setShowNewChatForm(false);
      } else {
        // Navigate to workspace
        setSelectedChatId(card.chatId);
        setShowNewChatForm(false);
      }
    },
    [setSelectedChatId, setSelectedDraftId, setShowNewChatForm, isMultiSelectMode, toggleChatSelection]
  );

  // Checkbox click handler for multi-select
  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation();
      toggleChatSelection(chatId);
    },
    [toggleChatSelection]
  );

  // Rename mutation
  const renameChatMutation = trpc.chats.rename.useMutation({
    onSuccess: () => {
      utils.chats.list.invalidate();
    },
    onError: () => {
      toast.error('Failed to rename workspace');
    }
  });

  // Rename handler
  const handleRenameClick = useCallback((chat: { id: string; name: string | null }) => {
    setRenamingChat(chat);
    setRenameDialogOpen(true);
  }, []);

  const handleRenameSave = async (newName: string) => {
    if (!renamingChat) return;
    await renameChatMutation.mutateAsync({ id: renamingChat.id, name: newName });
    setRenameDialogOpen(false);
    setRenamingChat(null);
  };

  // Archive mutation
  const archiveChatMutation = trpc.chats.archive.useMutation({
    onSuccess: () => {
      utils.chats.list.invalidate();
      utils.chats.listArchived.invalidate();
      toast.success('Workspace archived');
    },
    onError: () => {
      toast.error('Failed to archive workspace');
    }
  });

  // Archive handler with confirmation for active processes
  const handleArchive = useCallback(
    async (chatId: string) => {
      const allChatsList = [
        ...(Array.isArray(chats) ? chats : []),
        ...(Array.isArray(archivedChats) ? archivedChats : [])
      ];
      const chat = allChatsList.find((c) => c.id === chatId);
      const isLocalMode = !chat?.branch;
      // Local mode: terminals are shared and won't be killed on archive, so skip count
      const sessionCount = isLocalMode ? 0 : await utils.terminal.getActiveSessionCount.fetch({ workspaceId: chatId });

      if (sessionCount > 0) {
        setArchivingChatId(chatId);
        setActiveProcessCount(sessionCount);
        setConfirmArchiveDialogOpen(true);
      } else {
        await archiveChatMutation.mutateAsync({ id: chatId });
      }
    },
    [utils, archiveChatMutation, chats, archivedChats]
  );

  const handleConfirmArchive = useCallback(async () => {
    if (!archivingChatId) return;
    await archiveChatMutation.mutateAsync({ id: archivingChatId });
    setConfirmArchiveDialogOpen(false);
    setArchivingChatId(null);
  }, [archivingChatId, archiveChatMutation]);

  const handleCancelArchive = useCallback(() => {
    setConfirmArchiveDialogOpen(false);
    setArchivingChatId(null);
  }, []);

  // Copy branch name to clipboard
  const handleCopyBranch = useCallback((branch: string) => {
    navigator.clipboard.writeText(branch);
    toast.success('Branch name copied', { description: branch });
  }, []);

  // Export chat handler
  const handleExportChat = useCallback((params: { chatId: string; format: 'markdown' | 'json' | 'text' }) => {
    exportChat(params);
  }, []);

  // Copy chat handler
  const handleCopyChat = useCallback((params: { chatId: string; format: 'markdown' | 'json' | 'text' }) => {
    copyChat(params);
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Header with sidebar toggle + search.
          Drag region for window; interactive children opt out via WebkitAppRegion: "no-drag". */}
      <div
        className="flex-shrink-0 flex items-center p-1.5 gap-2"
        style={{
          WebkitAppRegion: 'drag'
        }}>
        <AgentsHeaderControls isSidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />

        {/* Search bar — opt out of drag region so clicks reach the input */}
        <div className="ml-auto flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
            <Input
              type="search"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 pr-3 text-xs w-40 focus:w-56 transition-all duration-200 bg-muted/40 border-transparent focus:border-border focus:bg-background rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoard
          cards={cards}
          pinnedChatIds={pinnedChatIds}
          isMultiSelectMode={isMultiSelectMode}
          selectedChatIds={selectedChatIds}
          onCardClick={handleCardClick}
          onCheckboxClick={handleCheckboxClick}
          onTogglePin={handleTogglePin}
          onRename={handleRenameClick}
          onArchive={handleArchive}
          onCopyBranch={handleCopyBranch}
          onExportChat={handleExportChat}
          onCopyChat={handleCopyChat}
        />
      </div>

      {/* Rename Dialog */}
      <AgentsRenameSubChatDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        currentName={renamingChat?.name || ''}
        onSave={handleRenameSave}
      />

      {/* Archive Confirmation Dialog */}
      <ConfirmArchiveDialog
        isOpen={confirmArchiveDialogOpen}
        onClose={handleCancelArchive}
        onConfirm={handleConfirmArchive}
        activeProcessCount={activeProcessCount}
      />
    </div>
  );
}
