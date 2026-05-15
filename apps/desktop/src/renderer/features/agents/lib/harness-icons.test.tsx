// @vitest-environment jsdom
/**
 * Task 11.5 — Per-harness icon rendering.
 *
 * (a) HarnessIcon renders the correct data-testid for each harness value.
 * (b) No claude-cli or codex-cli icon ever mounts for a builtin harness.
 * (c) HARNESS_LABELS registry is one-to-one: all 3 harnesses have a label,
 *     no label is shared across harness keys, no key is missing.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { HarnessIcon, HARNESS_LABELS, type Harness } from './harness-icons';

afterEach(cleanup);

const ALL_HARNESSES: Harness[] = ['builtin', 'claude-cli', 'codex-cli'];

// ── (a) Correct testid per harness ───────────────────────────────────────────

describe('(a) HarnessIcon renders the correct data-testid', () => {
  test.each(ALL_HARNESSES)('harness=%s → data-testid=harness-icon-%s', (harness) => {
    render(<HarnessIcon harness={harness} />);
    expect(screen.getByTestId(`harness-icon-${harness}`)).toBeTruthy();
  });
});

// ── (b) Builtin never shows a CLI icon ────────────────────────────────────────

describe('(b) builtin HarnessIcon never renders a CLI icon', () => {
  test('no claude-cli or codex-cli testid when harness=builtin', () => {
    render(<HarnessIcon harness="builtin" />);
    expect(screen.queryByTestId('harness-icon-claude-cli')).toBeNull();
    expect(screen.queryByTestId('harness-icon-codex-cli')).toBeNull();
    expect(screen.getByTestId('harness-icon-builtin')).toBeTruthy();
  });
});

// ── (c) HARNESS_LABELS registry completeness and one-to-one mapping ──────────

describe('(c) HARNESS_LABELS registry', () => {
  test('has an entry for every valid harness', () => {
    for (const h of ALL_HARNESSES) {
      expect(HARNESS_LABELS[h]).toBeTruthy();
    }
  });

  test('no duplicate labels across harness keys', () => {
    const values = Object.values(HARNESS_LABELS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  test('has exactly 3 keys — no extra harness added without updating the registry', () => {
    expect(Object.keys(HARNESS_LABELS)).toHaveLength(3);
  });
});
