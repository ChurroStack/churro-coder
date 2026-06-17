// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, cleanup, screen } from '@testing-library/react';
import { renderWithProviders, createTestStore } from '../../../../../test-utils';
import { chatMessageDensityAtom } from '../../../lib/atoms';
import { AgentBashTool } from './agent-bash-tool';

afterEach(cleanup);

const part = {
  type: 'tool-Bash',
  state: 'output-available',
  input: { command: 'echo hello' },
  output: { stdout: 'line1\nline2\nline3\nline4\nLAST_LINE', exitCode: 0 }
};

describe('AgentBashTool density [appearance/chat-message-density]', () => {
  it("'collapsed' shows only the header until expanded", () => {
    const store = createTestStore();
    store.set(chatMessageDensityAtom, 'collapsed');
    renderWithProviders(<AgentBashTool part={part} chatStatus="ready" />, { store });

    // Header is visible...
    expect(screen.getByText(/Ran command/)).toBeTruthy();
    // ...but the output body is hidden in collapsed density.
    expect(screen.queryByText(/LAST_LINE/)).toBeNull();

    // Clicking the header reveals the full output.
    fireEvent.click(screen.getByText(/Ran command/));
    expect(screen.getByText(/LAST_LINE/)).toBeTruthy();
  });

  it("'expanded' shows the full output untruncated by default", () => {
    const store = createTestStore();
    store.set(chatMessageDensityAtom, 'expanded');
    renderWithProviders(<AgentBashTool part={part} chatStatus="ready" />, { store });

    // The last line (beyond the 3-line default preview) is visible immediately.
    expect(screen.getByText(/LAST_LINE/)).toBeTruthy();
  });
});
