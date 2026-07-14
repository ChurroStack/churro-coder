import { describe, test, expect } from 'vitest';
import {
  coerceCodexThinking,
  computeOpusplanCommand,
  DEFAULT_CODEX_MODEL_ID,
  formatClaudeThinkingLabel,
  formatCodexThinkingLabel,
  formatModelLabel,
  formatThinkingLabel,
  getDefaultCodexModel,
  resolveCodexModel
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
    // max → xhigh not in ["low","medium"], "high" not in list → supported[0] = "low"
    expect(coerceCodexThinking('max', ['low', 'medium'])).toBe('low');
  });

  test("max stays 'max' when model supports max", () => {
    expect(coerceCodexThinking('max', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])).toBe('max');
  });

  test("ultra stays 'ultra' when model supports ultra", () => {
    expect(coerceCodexThinking('ultra', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])).toBe('ultra');
  });

  test("ultra degrades to 'max' when model supports max but not ultra", () => {
    expect(coerceCodexThinking('ultra', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe('max');
  });

  test("ultra degrades to 'xhigh' when model supports xhigh but not max/ultra", () => {
    expect(coerceCodexThinking('ultra', ['low', 'medium', 'high', 'xhigh'])).toBe('xhigh');
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

  test('gpt-5.6-terra → GPT-5.6-Terra', () => {
    expect(formatModelLabel('gpt-5.6-terra')).toBe('GPT-5.6-Terra');
  });

  test('gpt-5.6-sol → GPT-5.6-Sol', () => {
    expect(formatModelLabel('gpt-5.6-sol')).toBe('GPT-5.6-Sol');
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

describe('resolveCodexModel', () => {
  test('returns the configured default model when the id is missing', () => {
    expect(resolveCodexModel(undefined)?.id).toBe(DEFAULT_CODEX_MODEL_ID);
    expect(getDefaultCodexModel()?.id).toBe(DEFAULT_CODEX_MODEL_ID);
  });

  test('returns the configured default model when the id is retired', () => {
    expect(resolveCodexModel('gpt-5.3-codex')?.id).toBe(DEFAULT_CODEX_MODEL_ID);
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

describe('formatCodexThinkingLabel', () => {
  test('xhigh → Extra High', () => {
    expect(formatCodexThinkingLabel('xhigh')).toBe('Extra High');
  });

  test('max → Max', () => {
    expect(formatCodexThinkingLabel('max')).toBe('Max');
  });

  test('ultra → Ultra', () => {
    expect(formatCodexThinkingLabel('ultra')).toBe('Ultra');
  });

  test('high → High', () => {
    expect(formatCodexThinkingLabel('high')).toBe('High');
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
