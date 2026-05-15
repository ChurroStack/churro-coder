/**
 * Task 11.4 — Slash-command translation adapter (supersedes 3.4 for completeness).
 *
 * Per-harness adapter table: (currentModel, requestedModel) → composedPrefix.
 * Includes the "no translation needed" fall-through case and asserts it produces
 * an empty prefix plus a single `[harness-adapter] no-op` trace.
 *
 * Catches: adapter coupling to undocumented CLI internals; missing trace when
 * translation is skipped.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { buildHarnessPrefix, type HarnessAdapterHarness } from './harness-adapter';

const HARNESSES: HarnessAdapterHarness[] = ['builtin', 'claude-cli', 'codex-cli'];

// Capture console.log to verify trace output
let consoleSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ── No-op fall-through ────────────────────────────────────────────────────────

describe('buildHarnessPrefix — no-op fall-through', () => {
  test.each(HARNESSES)('returns empty string when no model change for harness=%s', (harness) => {
    const result = buildHarnessPrefix({
      harness,
      currentModel: 'claude-3-5-sonnet',
      requestedModel: 'claude-3-5-sonnet'
    });
    expect(result).toBe('');
  });

  test.each(HARNESSES)('returns empty string when no params differ for harness=%s', (harness) => {
    const result = buildHarnessPrefix({ harness });
    expect(result).toBe('');
  });

  test.each(['claude-cli', 'codex-cli'] as HarnessAdapterHarness[])(
    'emits [harness-adapter] no-op trace when no translation needed for harness=%s',
    (harness) => {
      buildHarnessPrefix({ harness, subChatId: 'sc-test', currentModel: 'x', requestedModel: 'x' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[harness-adapter] no-op'));
    }
  );
});

// ── builtin harness always returns '' ────────────────────────────────────────

describe('buildHarnessPrefix — builtin always empty', () => {
  test('returns "" regardless of model change', () => {
    const result = buildHarnessPrefix({ harness: 'builtin', currentModel: 'gpt-4', requestedModel: 'claude-opus' });
    expect(result).toBe('');
  });

  test('does NOT emit a no-op trace for builtin (native API handles it)', () => {
    buildHarnessPrefix({ harness: 'builtin', currentModel: 'x', requestedModel: 'x' });
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

// ── Model change translations ─────────────────────────────────────────────────

describe('buildHarnessPrefix — model change', () => {
  test('claude-cli model change produces /model <id> prefix', () => {
    const result = buildHarnessPrefix({
      harness: 'claude-cli',
      subChatId: 'sc-1',
      currentModel: 'claude-3-5-sonnet-20241022',
      requestedModel: 'claude-opus-4-5'
    });
    expect(result).toContain('/model claude-opus-4-5');
  });

  test('claude-cli model change prefix ends without trailing newline (prefix is joined)', () => {
    const result = buildHarnessPrefix({
      harness: 'claude-cli',
      currentModel: 'old',
      requestedModel: 'new-model'
    });
    expect(result.endsWith('\n')).toBe(false);
    expect(result).toBe('/model new-model');
  });

  test('codex-cli model change returns "" (codex does not support /model slash)', () => {
    const result = buildHarnessPrefix({
      harness: 'codex-cli',
      currentModel: 'gpt-4o',
      requestedModel: 'o3-mini'
    });
    expect(result).toBe('');
  });

  test('null requestedModel is treated as no change', () => {
    const result = buildHarnessPrefix({
      harness: 'claude-cli',
      currentModel: 'claude-3-5-sonnet',
      requestedModel: null
    });
    expect(result).toBe('');
  });
});

// ── Adapter table completeness ────────────────────────────────────────────────

describe('buildHarnessPrefix — adapter table completeness', () => {
  const CELLS = [
    { harness: 'builtin' as HarnessAdapterHarness, sameModel: true, expected: '' },
    { harness: 'builtin' as HarnessAdapterHarness, sameModel: false, expected: '' },
    { harness: 'claude-cli' as HarnessAdapterHarness, sameModel: true, expected: '' },
    { harness: 'claude-cli' as HarnessAdapterHarness, sameModel: false, expected: '/model new' },
    { harness: 'codex-cli' as HarnessAdapterHarness, sameModel: true, expected: '' },
    { harness: 'codex-cli' as HarnessAdapterHarness, sameModel: false, expected: '' }
  ];

  test.each(CELLS)('harness=$harness sameModel=$sameModel → "$expected"', ({ harness, sameModel, expected }) => {
    const result = buildHarnessPrefix({
      harness,
      currentModel: 'old',
      requestedModel: sameModel ? 'old' : 'new'
    });
    expect(result).toBe(expected);
  });
});
