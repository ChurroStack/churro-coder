// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { AGENT_MODES, getNextMode, normalizeAgentMode } from './index';

describe('getNextMode', () => {
  test('cycles plan → execute → explore → plan', () => {
    expect(getNextMode('plan')).toBe('execute');
    expect(getNextMode('execute')).toBe('explore');
    expect(getNextMode('explore')).toBe('plan');
  });

  test('AGENT_MODES is exactly [plan, execute, explore]', () => {
    expect(AGENT_MODES).toEqual(['plan', 'execute', 'explore']);
  });
});

describe('normalizeAgentMode', () => {
  test('legacy "agent" → "execute"', () => {
    expect(normalizeAgentMode('agent')).toBe('execute');
  });

  test('preserves canonical modes', () => {
    expect(normalizeAgentMode('plan')).toBe('plan');
    expect(normalizeAgentMode('execute')).toBe('execute');
    expect(normalizeAgentMode('explore')).toBe('explore');
  });

  test('unknown / null / undefined → "plan"', () => {
    expect(normalizeAgentMode(null)).toBe('plan');
    expect(normalizeAgentMode(undefined)).toBe('plan');
    expect(normalizeAgentMode('review')).toBe('plan');
    expect(normalizeAgentMode('')).toBe('plan');
  });
});
