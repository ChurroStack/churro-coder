// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '../../../../../test-utils';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { AgentTaskTool } from './agent-task-tool';

afterEach(cleanup);

// A completed subagent whose rich `toolUseResult` landed on `part.output`
// (the CLI-ingest fix). Mirrors the native Claude CLI's Explore subagent shape.
const COMPLETED_PART = {
  type: 'tool-Agent',
  toolCallId: 'task-1',
  state: 'output-available',
  input: { description: 'Line-by-line correctness scan', subagent_type: 'Explore' },
  output: {
    status: 'completed',
    agentType: 'Explore',
    totalTokens: 67917,
    totalToolUseCount: 31,
    toolStats: { readCount: 18, searchCount: 0, bashCount: 13, editFileCount: 0, linesAdded: 0, linesRemoved: 0 },
    content: [{ type: 'text', text: 'Investigation summary lives here.' }]
  }
};

function renderTask(part: unknown) {
  return renderWithProviders(
    <TooltipProvider>
      <AgentTaskTool part={part} nestedTools={[]} chatStatus="ready" />
    </TooltipProvider>
  );
}

describe('AgentTaskTool — rich subagent rendering [cli-subagent-enrichment]', () => {
  it('shows the agent type, description, tool-use + token counts, and activity summary', () => {
    const { getByText } = renderTask(COMPLETED_PART);

    // Native-style label = agent type, not the generic "Completed Subagent".
    expect(getByText('Explore')).toBeTruthy();
    expect(getByText('Line-by-line correctness scan')).toBeTruthy();
    // Inline counts from totalToolUseCount + totalTokens (67917 → "67.9k").
    expect(getByText(/31 tool uses/)).toBeTruthy();
    expect(getByText(/67\.9k tok/)).toBeTruthy();
    // Activity line derived from toolStats (zero buckets omitted).
    expect(getByText('18 reads · 13 commands')).toBeTruthy();
  });

  it('reveals the subagent reply only after expanding', () => {
    const { getByText, queryByText } = renderTask(COMPLETED_PART);

    // Collapsed by default — reply hidden.
    expect(queryByText('Investigation summary lives here.')).toBeNull();

    // Clicking the row toggles expansion (onClick lives on the header container).
    fireEvent.click(getByText('Explore'));
    expect(getByText('Investigation summary lives here.')).toBeTruthy();
  });

  it('falls back to output.agentType when input has no subagent_type', () => {
    const { getByText } = renderTask({ ...COMPLETED_PART, input: { description: 'Some work' } });
    expect(getByText('Explore')).toBeTruthy();
  });

  it('hides the activity line when the subagent did no tracked work', () => {
    const part = {
      ...COMPLETED_PART,
      output: {
        ...COMPLETED_PART.output,
        toolStats: { readCount: 0, searchCount: 0, bashCount: 0, editFileCount: 0, linesAdded: 0, linesRemoved: 0 }
      }
    };
    const { queryByText } = renderTask(part);
    expect(queryByText(/\d+\s+(reads?|commands?|edits?|searches?)/)).toBeNull();
  });
});
