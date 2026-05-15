// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';

vi.mock('../hooks/use-sub-chat-mode', () => ({
  useSubChatMode: () => ({ mode: 'plan', setMode: vi.fn() })
}));

vi.mock('../../dock/dock-context', () => ({
  useDockApi: () => ({})
}));

vi.mock('../../dock/add-or-focus', () => ({
  addOrFocus: vi.fn()
}));

import { renderWithProviders } from '../../../../../test-utils';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { pendingBuildPlanSubChatIdAtom } from '../atoms';
import { useAgentSubChatStore } from '../stores/sub-chat-store';
import { AgentPlanFileTool } from './agent-plan-file-tool';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PART = {
  type: 'tool-Write',
  state: 'output-available',
  input: { file_path: 'plan.md', content: '# Plan\nstep 1' }
};

describe('AgentPlanFileTool — Approve uses subChatId prop, not store', () => {
  /**
   * Regression: in dockview multi-pane the Zustand store's `activeSubChatId`
   * may point at a different pane's sub-chat than the one whose plan tool
   * is being rendered. The Approve handler must route to the *prop's*
   * sub-chat (the one this tool instance belongs to), not the store's.
   */
  it('sets pendingBuildPlanSubChatIdAtom to the subChatId prop, not the store-active id', () => {
    // Store reports a *different* active sub-chat than the prop.
    useAgentSubChatStore.setState({ activeSubChatId: 'other-sub-B' });

    const { container, store } = renderWithProviders(
      <TooltipProvider>
        <AgentPlanFileTool part={PART} subChatId="my-sub-A" chatStatus="ready" />
      </TooltipProvider>
    );

    const approveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve'));
    expect(approveBtn).toBeTruthy();

    fireEvent.click(approveBtn!);

    expect(store.get(pendingBuildPlanSubChatIdAtom)).toBe('my-sub-A');
  });

  it('still routes via the prop when the store has no active sub-chat', () => {
    useAgentSubChatStore.setState({ activeSubChatId: null });

    const { container, store } = renderWithProviders(
      <TooltipProvider>
        <AgentPlanFileTool part={PART} subChatId="my-sub-A" chatStatus="ready" />
      </TooltipProvider>
    );

    const approveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve'));
    fireEvent.click(approveBtn!);

    expect(store.get(pendingBuildPlanSubChatIdAtom)).toBe('my-sub-A');
  });
});
