// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import type { ReactElement } from 'react';

const removeFromSplit = vi.fn();
let splitPaneCount = 3;

// Mock the entire sub-chat-store module so the component renders without
// pulling in the real zustand store, the windowId resolver, or localStorage.
vi.mock('../stores/sub-chat-store', () => ({
  useAgentSubChatStore: <T,>(selector: (state: any) => T): T =>
    selector({
      removeFromSplit,
      splitPaneIds: Array.from({ length: splitPaneCount }, (_, i) => `id-${i}`)
    })
}));

import { SplitPaneInlineClose } from './split-pane-inline-close';

const wrap = (node: ReactElement) => render(<TooltipProvider>{node}</TooltipProvider>);

afterEach(() => {
  cleanup();
  removeFromSplit.mockClear();
  splitPaneCount = 3;
});

describe('SplitPaneInlineClose', () => {
  test("renders 'Remove from split' aria-label when more than 2 panes", () => {
    splitPaneCount = 3;
    const { getByRole } = wrap(<SplitPaneInlineClose subChatId="sub-1" />);
    const btn = getByRole('button', { name: /Remove from split/ });
    expect(btn).toBeTruthy();
  });

  test("renders 'Close split view' aria-label when exactly 2 panes (last pair)", () => {
    splitPaneCount = 2;
    const { getByRole } = wrap(<SplitPaneInlineClose subChatId="sub-1" />);
    const btn = getByRole('button', { name: /Close split view/ });
    expect(btn).toBeTruthy();
  });

  test('clicking the button calls removeFromSplit with the subChatId', () => {
    const { getByRole } = wrap(<SplitPaneInlineClose subChatId="sub-42" />);
    fireEvent.click(getByRole('button'));
    expect(removeFromSplit).toHaveBeenCalledTimes(1);
    expect(removeFromSplit).toHaveBeenCalledWith('sub-42');
  });

  test("click event is stopped from propagating (doesn't activate parent row)", () => {
    const onParentClick = vi.fn();
    const { getByRole } = wrap(
      <div onClick={onParentClick}>
        <SplitPaneInlineClose subChatId="sub-1" />
      </div>
    );
    fireEvent.click(getByRole('button'));
    expect(onParentClick).not.toHaveBeenCalled();
    expect(removeFromSplit).toHaveBeenCalledTimes(1);
  });
});
