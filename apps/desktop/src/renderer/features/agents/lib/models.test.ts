import { describe, test, expect } from 'vitest';
import {
  coerceCodexThinking,
  computeOpusplanCommand,
  formatClaudeThinkingLabel,
  formatModelLabel,
  formatThinkingLabel
} from './models';

describe('coerceCodexThinking', () => {
  test('max → xhigh when xhigh is supported', () => {
    expect(coerceCodexThinking('max', ['low', 'medium', 'high', 'xhigh'])).toBe('xhigh');
  });

  test('off → low when low is supported', () => {
    expect(coerceCodexThinking('off', ['low', 'medium', 'high'])).toBe('low');
  });

  test('off when low not supported → falls through to high', () => {
    expect(coerceCodexThinking('off', ['medium', 'high'])).toBe('high');
  });

  test('preferred level supported → returned as-is', () => {
    expect(coerceCodexThinking('medium', ['low', 'medium', 'high'])).toBe('medium');
  });

  test('xhigh preferred but not in supported → falls back to high', () => {
    expect(coerceCodexThinking('xhigh', ['low', 'medium', 'high'])).toBe('high');
  });

  test('xhigh preferred, high not in supported → returns first supported (low)', () => {
    // xhigh not in list, "high" not in list → supported[0] = "low"
    expect(coerceCodexThinking('xhigh', ['low', 'medium'])).toBe('low');
  });

  test("empty supported list → returns 'high' sentinel", () => {
    expect(coerceCodexThinking('xhigh', [])).toBe('high');
  });

  test("max with only low/medium → returns supported[0] = 'low'", () => {
    // max → xhigh → not in ["low","medium"], "high" not in list → supported[0] = "low"
    expect(coerceCodexThinking('max', ['low', 'medium'])).toBe('low');
  });
});

describe('formatModelLabel', () => {
  test('undefined → empty string', () => {
    expect(formatModelLabel(undefined)).toBe('');
  });

  test('opus → Claude Opus 4.8', () => {
    expect(formatModelLabel('opus')).toBe('Claude Opus 4.8');
  });

  test('opus[1m] → Claude Opus 4.8 1M (exact-id match wins)', () => {
    expect(formatModelLabel('opus[1m]')).toBe('Claude Opus 4.8 1M');
  });

  test('claude-opus-4-7 → Claude Opus 4.7 (exact-id match for legacy version pin)', () => {
    expect(formatModelLabel('claude-opus-4-7')).toBe('Claude Opus 4.7');
  });

  test('claude-opus-4-6 → Claude Opus 4.6 (exact-id match for legacy version pin)', () => {
    expect(formatModelLabel('claude-opus-4-6')).toBe('Claude Opus 4.6');
  });

  test('sonnet → Claude Sonnet 5', () => {
    expect(formatModelLabel('sonnet')).toBe('Claude Sonnet 5');
  });

  test('haiku → Claude Haiku 4.5', () => {
    expect(formatModelLabel('haiku')).toBe('Claude Haiku 4.5');
  });

  test('fable → Claude Fable 5', () => {
    expect(formatModelLabel('fable')).toBe('Claude Fable 5');
  });

  test('opusplan → Opus Plan auto (CLI-only alias)', () => {
    expect(formatModelLabel('opusplan')).toBe('Opus Plan auto');
  });

  test('gpt-5.4 → GPT-5.4', () => {
    expect(formatModelLabel('gpt-5.4')).toBe('GPT-5.4');
  });

  test('gpt-5.3-codex-spark → Codex 5.3 (prefix-matches gpt-5.3-codex first)', () => {
    expect(formatModelLabel('gpt-5.3-codex-spark')).toBe('Codex 5.3');
  });

  test('gpt-5.4-mini → GPT-5.4 (prefix-matches gpt-5.4 first)', () => {
    expect(formatModelLabel('gpt-5.4-mini')).toBe('GPT-5.4');
  });

  test('unknown id → returned as-is', () => {
    expect(formatModelLabel('unknown-model-xyz')).toBe('unknown-model-xyz');
  });
});

describe('computeOpusplanCommand', () => {
  test('opus + sonnet → opusplan', () => {
    expect(computeOpusplanCommand('opus', 'sonnet')).toBe('opusplan');
  });

  test('opus[1m] + sonnet → opusplan (no opusplan[1m] alias)', () => {
    expect(computeOpusplanCommand('opus[1m]', 'sonnet')).toBe('opusplan');
  });

  test('opus + sonnet[1m] → opusplan', () => {
    expect(computeOpusplanCommand('opus', 'sonnet[1m]')).toBe('opusplan');
  });

  test('opus + haiku → undefined', () => {
    expect(computeOpusplanCommand('opus', 'haiku')).toBeUndefined();
  });

  test('sonnet plan + sonnet execute → undefined', () => {
    expect(computeOpusplanCommand('sonnet', 'sonnet')).toBeUndefined();
  });

  test('pinned opus version (claude-opus-4-7) is not the opus alias → undefined', () => {
    expect(computeOpusplanCommand('claude-opus-4-7', 'sonnet')).toBeUndefined();
  });
});

describe('formatClaudeThinkingLabel', () => {
  test('off → Off', () => {
    expect(formatClaudeThinkingLabel('off')).toBe('Off');
  });

  test('low → Low', () => {
    expect(formatClaudeThinkingLabel('low')).toBe('Low');
  });

  test('high → High', () => {
    expect(formatClaudeThinkingLabel('high')).toBe('High');
  });

  test('xhigh → Extra High', () => {
    expect(formatClaudeThinkingLabel('xhigh')).toBe('Extra High');
  });

  test('max → Max', () => {
    expect(formatClaudeThinkingLabel('max')).toBe('Max');
  });
});

describe('formatThinkingLabel', () => {
  test('formats Claude thinking labels from metadata', () => {
    expect(formatThinkingLabel({ model: 'sonnet', thinking: 'xhigh' })).toBe('Extra High');
  });

  test('formats Codex thinking labels from metadata', () => {
    expect(formatThinkingLabel({ model: 'gpt-5.4', thinking: 'medium' })).toBe('Medium');
  });

  test('passes through unknown effort strings with capitalization', () => {
    expect(formatThinkingLabel({ model: 'unknown-model', thinking: 'turbo' })).toBe('Turbo');
  });
});
