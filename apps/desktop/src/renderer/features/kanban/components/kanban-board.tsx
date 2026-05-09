import { memo, useMemo } from 'react';
import { KanbanColumn } from './kanban-column';
import type { KanbanCardData } from './kanban-card';
import type { KanbanStatus } from '../lib/kanban-state-machine';

interface KanbanBoardProps {
  cards: KanbanCardData[];
  pinnedChatIds: Set<string>;
  isMultiSelectMode: boolean;
  selectedChatIds: Set<string>;
  onCardClick: (card: KanbanCardData, e: React.MouseEvent) => void;
  onCheckboxClick: (e: React.MouseEvent, chatId: string) => void;
  onTogglePin: (chatId: string) => void;
  onRename: (chat: { id: string; name: string | null }) => void;
  onArchive: (chatId: string) => void;
  onCopyBranch: (branch: string) => void;
  onExportChat: (params: { chatId: string; format: 'markdown' | 'json' | 'text' }) => void;
  onCopyChat: (params: { chatId: string; format: 'markdown' | 'json' | 'text' }) => void;
}

// 6 SDLC columns
const COLUMNS: { status: KanbanStatus; title: string }[] = [
  { status: 'draft', title: 'Drafts' },
  { status: 'planning', title: 'Planning' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'in-review', title: 'In Review' },
  { status: 'done', title: 'Done' },
  { status: 'archived', title: 'Archived' }
];

export const KanbanBoard = memo(function KanbanBoard({
  cards,
  isMultiSelectMode,
  onCardClick,
  onCheckboxClick,
  onTogglePin,
  onRename,
  onArchive,
  onCopyBranch,
  onExportChat,
  onCopyChat
}: KanbanBoardProps) {
  // Group cards by status
  const cardsByStatus = useMemo(() => {
    const grouped: Record<KanbanStatus, KanbanCardData[]> = {
      draft: [],
      planning: [],
      'in-progress': [],
      'in-review': [],
      done: [],
      archived: []
    };

    for (const card of cards) {
      grouped[card.status].push(card);
    }

    return grouped;
  }, [cards]);

  return (
    <div className="h-full overflow-hidden">
      {/* Full-width responsive container: columns share viewport via flex-1 + min-w-0,
          shrinking together as the window narrows. No horizontal scroll. */}
      <div className="flex gap-3 h-full px-4 py-2 w-full">
        {COLUMNS.map((column) => (
          <KanbanColumn
            key={column.status}
            title={column.title}
            status={column.status}
            cards={cardsByStatus[column.status]}
            isMultiSelectMode={isMultiSelectMode}
            onCardClick={onCardClick}
            onCheckboxClick={onCheckboxClick}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onArchive={onArchive}
            onCopyBranch={onCopyBranch}
            onExportChat={onExportChat}
            onCopyChat={onCopyChat}
          />
        ))}
      </div>
    </div>
  );
});
