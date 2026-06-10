// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestStore } from '../../../../test-utils/create-test-store';
import { workspaceProjectSettingsSectionAtomFamily } from '../dock/atoms';
import { WorkspaceProjectSettings } from './workspace-project-settings';

// Stub the heavy section bodies so we test only the atom-driven section routing.
vi.mock('../../components/dialogs/settings-tabs/worktree-config-section', () => ({
  WorktreeConfigSection: () => <div>WORKTREE-SECTION</div>
}));
vi.mock('../../components/dialogs/settings-tabs/agents-skills-tab', () => ({
  AgentsSkillsTab: () => <div>SKILLS-SECTION</div>
}));
vi.mock('../../components/dialogs/settings-tabs/agents-custom-agents-tab', () => ({
  AgentsCustomAgentsTab: () => <div>AGENTS-SECTION</div>
}));
vi.mock('../../components/dialogs/settings-tabs/agents-mcp-tab', () => ({
  AgentsMcpTab: () => <div>MCP-SECTION</div>
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    projects: { get: { useQuery: () => ({ data: { id: 'p1', name: 'Proj', path: '/base' } }) } }
  }
}));

afterEach(cleanup);

function renderPanel(store = createTestStore()) {
  return {
    store,
    ...render(
      <Provider store={store}>
        <WorkspaceProjectSettings workspaceId="ws1" projectId="p1" path="/base/wt" projectName="Proj" />
      </Provider>
    )
  };
}

describe('WorkspaceProjectSettings — section routing', () => {
  it('defaults to the Worktree section', () => {
    renderPanel();
    expect(screen.getByText('WORKTREE-SECTION')).toBeTruthy();
  });

  it('clicking a section tab switches the rendered section', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'MCP' }));
    expect(screen.getByText('MCP-SECTION')).toBeTruthy();
    expect(screen.queryByText('WORKTREE-SECTION')).toBeNull();
  });

  it('honors a deep-link set externally on the per-workspace section atom (even before render)', () => {
    const store = createTestStore();
    // Simulates the details-sidebar MCP gear deep-linking to the MCP section.
    store.set(workspaceProjectSettingsSectionAtomFamily('ws1'), 'mcp');
    renderPanel(store);
    expect(screen.getByText('MCP-SECTION')).toBeTruthy();
  });
});
