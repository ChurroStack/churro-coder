import { describe, expect, test } from 'vitest';
import { decideCodexMcpElicitation } from './codex-mcp-elicitation';

describe('decideCodexMcpElicitation', () => {
  test('accepts app-owned churro-coder MCP server elicitation', () => {
    expect(decideCodexMcpElicitation({ server: 'churro-coder-dev', tool: 'read_plan' })).toMatchObject({
      action: 'accept',
      content: null,
      reason: 'app-owned-server:churro-coder-dev'
    });
  });

  test('accepts read_plan even when Codex omits server metadata', () => {
    expect(decideCodexMcpElicitation({ toolName: 'read_plan' })).toMatchObject({
      action: 'accept',
      reason: 'app-owned-tool:read_plan'
    });
  });

  test('accepts text-only read_plan/churro-coder elicitation shapes', () => {
    expect(
      decideCodexMcpElicitation({
        prompt: 'Allow MCP tool call read_plan on churro-coder?'
      })
    ).toMatchObject({
      action: 'accept',
      reason: 'app-owned-text-match:read_plan'
    });
  });

  test('declines unknown MCP elicitation', () => {
    expect(decideCodexMcpElicitation({ server: 'external-mcp', tool: 'dangerous_tool' })).toMatchObject({
      action: 'decline',
      content: null,
      reason: 'unknown-mcp-elicitation'
    });
  });
});
