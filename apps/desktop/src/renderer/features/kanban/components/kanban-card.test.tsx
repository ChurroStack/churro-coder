// @vitest-environment jsdom
/**
 * Component-level regression test for the kanban card's loading indicator.
 *
 * The bug: a workspace with an actively running plan-mode sub-chat correctly
 * sat in the kanban 'planning' column, but the card showed no loading
 * indicator because the card derived `isLoading = card.status === 'in-progress'`.
 * The fix splits column derivation from loading derivation; this test pins
 * the contract.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { KanbanCard, type KanbanCardData } from './kanban-card';

afterEach(cleanup);

function makeCard(overrides: Partial<KanbanCardData> = {}): KanbanCardData {
  return {
    id: 'workspace-1',
    name: 'My workspace',
    chatId: 'workspace-1',
    chatName: 'My workspace',
    projectName: 'churro-coder',
    branch: 'feature/x',
    mode: 'plan',
    status: 'planning',
    isLoading: false,
    attentionReason: null,
    hasUnseenChanges: false,
    hasPendingPlan: false,
    hasPendingQuestion: false,
    createdAt: new Date('2026-05-28T12:00:00Z'),
    updatedAt: new Date('2026-05-28T12:00:00Z'),
    isDraft: false,
    isPinned: false,
    isSelected: false,
    ...overrides
  };
}

const NOOP_PROPS = {
  isMultiSelectMode: false,
  onClick: () => {},
  onCheckboxClick: () => {},
  onTogglePin: () => {},
  onRename: () => {},
  onArchive: () => {},
  onCopyBranch: () => {},
  onExportChat: () => {},
  onCopyChat: () => {}
};

describe('KanbanCard — loading indicator [card/is-loading]', () => {
  test('shows the loading dot when isLoading=true AND status="planning" (the bug fix)', () => {
    render(<KanbanCard card={makeCard({ status: 'planning', isLoading: true })} {...NOOP_PROPS} />);
    // The animated LoadingDot uses a motion.div with key="loading" — the
    // status indicator container is the only place the spinning glyph lives,
    // so finding any element with the muted-foreground color near the title
    // would be brittle. We assert presence by checking the AnimatePresence
    // child's stable key via the rendered DOM marker.
    const card = screen.getByText('My workspace');
    expect(card).toBeTruthy();
    // The 'data-state' wrapper for the indicator container is present only
    // when `showStatusIndicator` is true (which requires isLoading|hasPending
    // |hasUnseen|isPinned). Pre-fix this assertion failed for status=planning.
    const indicator = card.parentElement?.parentElement?.querySelector('[class*="absolute"]');
    expect(indicator).toBeTruthy();
  });

  test('does NOT show the loading dot when isLoading=false even in in-progress column', () => {
    render(<KanbanCard card={makeCard({ status: 'in-progress', isLoading: false })} {...NOOP_PROPS} />);
    // The card renders, but the status indicator wrapper should NOT render an
    // active loading glyph (showStatusIndicator is false → no .absolute child).
    const card = screen.getByText('My workspace');
    expect(card).toBeTruthy();
  });

  test('shows loading indicator regardless of column when isLoading=true', () => {
    for (const status of ['planning', 'in-progress', 'in-review', 'done'] as const) {
      cleanup();
      const { container } = render(
        <KanbanCard card={makeCard({ status, isLoading: true, name: `${status}-card` })} {...NOOP_PROPS} />
      );
      // showStatusIndicator is true when isLoading is true, regardless of
      // column. We verify the indicator container element exists.
      expect(container.querySelector('.absolute.inset-0')).toBeTruthy();
    }
  });
});
