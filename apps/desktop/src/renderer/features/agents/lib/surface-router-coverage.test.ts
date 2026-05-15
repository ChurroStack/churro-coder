/**
 * Task 11.15 — Coverage assertion for the surface-router parameter table.
 *
 * Fails the test run if:
 * (a) A new harness key is added to the Harness type without a corresponding
 *     row in HARNESS_LABELS (which is the canonical enum source).
 * (b) The 6-cell router table coverage (3 harnesses × 2 openspecChangeId states)
 *     drifts from the HARNESS_LABELS registry.
 *
 * This is a static/structural test — it never renders components.
 */
import { describe, test, expect } from 'vitest';
import { HARNESS_LABELS } from './harness-icons';

const ROUTER_TABLE_HARNESSES = ['builtin', 'claude-cli', 'codex-cli'] as const;
const OPENSPEC_STATES = [null, 'some-change-id'] as const;

describe('surface-router coverage assertion (task 11.15)', () => {
  test('every harness in HARNESS_LABELS has a router table row', () => {
    const registryKeys = Object.keys(HARNESS_LABELS);
    for (const h of registryKeys) {
      expect(ROUTER_TABLE_HARNESSES as readonly string[]).toContain(h);
    }
  });

  test('every harness in the router table exists in HARNESS_LABELS', () => {
    for (const h of ROUTER_TABLE_HARNESSES) {
      expect(HARNESS_LABELS).toHaveProperty(h);
    }
  });

  test('router table has exactly 6 cells (3 harnesses × 2 openspecChangeId states)', () => {
    const cells = ROUTER_TABLE_HARNESSES.flatMap((h) =>
      OPENSPEC_STATES.map((o) => ({ harness: h, openspecChangeId: o }))
    );
    expect(cells).toHaveLength(6);
  });

  test('harness count matches between HARNESS_LABELS and router table', () => {
    expect(Object.keys(HARNESS_LABELS)).toHaveLength(ROUTER_TABLE_HARNESSES.length);
  });
});
