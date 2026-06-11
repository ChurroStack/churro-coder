import { describe, it, expect } from 'vitest';
import { getToolName, isInteractiveToolCall } from './interactive-tools';

describe('interactive-tools', () => {
  const toolCall = (name: string) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } });

  it('extracts the tool name from a tools/call body', () => {
    expect(getToolName(toolCall('write_plan'))).toBe('write_plan');
    expect(getToolName(toolCall('request_user_input'))).toBe('request_user_input');
  });

  it('returns undefined for non-tools/call bodies', () => {
    expect(getToolName({ method: 'initialize' })).toBeUndefined();
    expect(getToolName(undefined)).toBeUndefined();
    expect(getToolName({ method: 'tools/call', params: {} })).toBeUndefined();
  });

  it('handles a batched (array) body by inspecting the first envelope', () => {
    expect(getToolName([toolCall('request_user_input')])).toBe('request_user_input');
  });

  it('flags request_user_input as interactive (watchdog-exempt) and nothing else', () => {
    expect(isInteractiveToolCall(toolCall('request_user_input'))).toBe(true);
    expect(isInteractiveToolCall(toolCall('write_plan'))).toBe(false);
    expect(isInteractiveToolCall(toolCall('notify_files_changed'))).toBe(false);
    expect(isInteractiveToolCall({ method: 'initialize' })).toBe(false);
  });
});
