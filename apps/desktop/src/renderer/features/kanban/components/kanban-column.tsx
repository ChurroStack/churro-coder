import { memo, useMemo, useState, useEffect } from 'react';
import { cn } from '../../../lib/utils';
import { KanbanCard, type KanbanCardData } from './kanban-card';
import type { KanbanStatus } from '../lib/kanban-state-machine';
import { Button } from '../../../components/ui/button';

interface KanbanColumnProps {
  title: string;
  status: KanbanStatus;
  cards: KanbanCardData[];
  isMultiSelectMode: boolean;
  onCardClick: (card: KanbanCardData, e: React.MouseEvent) => void;
  onCheckboxClick: (e: React.MouseEvent, chatId: string) => void;
  onTogglePin: (chatId: string) => void;
  onRename: (chat: { id: string; name: string | null }) => void;
  onArchive: (chatId: string) => void;
  onCopyBranch: (branch: string) => void;
  onExportChat: (params: { chatId: string; format: 'markdown' | 'json' | 'text' }) => void;
  onCopyChat: (params: { chatId: string; format: 'markdown' | 'json' | 'text' }) => void;
}

const PAGE_SIZE = 15;

const STATUS_COLORS: Record<KanbanStatus, string> = {
  draft: 'bg-muted-foreground/20',
  planning: 'bg-slate-500',
  'in-progress': 'bg-blue-500',
  'in-review': 'bg-violet-500',
  done: 'bg-emerald-500',
  archived: 'bg-muted-foreground/40'
};

export const KanbanColumn = memo(function KanbanColumn({
  title,
  status,
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
}: KanbanColumnProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when the card set changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [cards.length]);

  // Split into three groups, each sorted oldest→newest by createdAt
  const { attentionCards, pinnedCards, regularCards, ordered } = useMemo(() => {
    const sortAsc = (a: KanbanCardData, b: KanbanCardData) => a.createdAt.getTime() - b.createdAt.getTime();

    const attention = cards.filter((c) => c.attentionReason != null).sort(sortAsc);
    const userPinned = cards.filter((c) => c.attentionReason == null && c.isPinned).sort(sortAsc);
    const regular = cards.filter((c) => c.attentionReason == null && !c.isPinned).sort(sortAsc);

    return {
      attentionCards: attention,
      pinnedCards: userPinned,
      regularCards: regular,
      ordered: [...attention, ...userPinned, ...regular]
    };
  }, [cards]);

  // Attention cards are always fully shown; pagination applies to the rest
  const nonAttentionCount = pinnedCards.length + regularCards.length;
  const visibleNonAttention = Math.min(visibleCount, nonAttentionCount);
  const visibleOrdered = [
    ...attentionCards,
    ...ordered.slice(attentionCards.length, attentionCards.length + visibleNonAttention)
  ];
  const hiddenCount = nonAttentionCount - visibleNonAttention;

  const renderCard = (card: KanbanCardData) => (
    <KanbanCard
      key={card.id}
      card={card}
      isMultiSelectMode={isMultiSelectMode}
      onClick={(e) => onCardClick(card, e)}
      onCheckboxClick={onCheckboxClick}
      onTogglePin={onTogglePin}
      onRename={onRename}
      onArchive={onArchive}
      onCopyBranch={onCopyBranch}
      onExportChat={onExportChat}
      onCopyChat={onCopyChat}
    />
  );

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2 mb-2">
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_COLORS[status])} />
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">{cards.length}</span>
      </div>

      {/* Cards container with scroll */}
      <div className="flex-1 overflow-y-auto px-1 pb-4 space-y-2">
        {cards.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground/60">No workspaces</div>
        ) : (
          <>
            {/* Needs-attention section (always shown, always at top) */}
            {attentionCards.length > 0 && <div className="mb-1 space-y-2">{attentionCards.map(renderCard)}</div>}

            {/* Pinned + regular cards (paginated) */}
            {visibleOrdered.slice(attentionCards.length).map(renderCard)}

            {/* View more button */}
            {hiddenCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground h-7"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                View more ({hiddenCount})
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
});
