// @vitest-environment jsdom
/**
 * Cold-start regression: sidebar widgets must repopulate after an app restart
 * even though the in-memory atoms are empty. Storage is file-backed under
 * <userData>/sub-chats/<subChatId>/{plans,reviews,...}, so the tRPC routes
 * read from disk on every cold mount.
 *
 * The Plan widget is the special case: it renders only when
 * `currentPlanPathAtomFamily(subChatId)` resolves to a non-null path. That
 * atom is in-memory only, so on a cold start it stays empty until DetailsRail
 * seeds it from `getCurrentPlan().filePath`. The probe below mirrors the
 * minimal hook block from details-rail.tsx so the regression is pinned to the
 * exact mechanism, not the full DetailsRail tree (which has ~15 dependencies
 * and is impractical to mount in a unit test).
 */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React, { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

// ── hoisted mock refs ─────────────────────────────────────────────────────────

const { mockGetCurrentPlan } = vi.hoisted(() => ({
  mockGetCurrentPlan: vi.fn()
}));

// ── tRPC mock ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/trpc', () => ({
  trpc: {
    chats: {
      getCurrentPlan: { useQuery: mockGetCurrentPlan }
    }
  }
}));

import { trpc } from '@/lib/trpc';
import { currentPlanPathAtomFamily } from '@/features/agents/atoms';

// PlanPathHydrationProbe — mirrors the block added to details-rail.tsx.
// Asserting against this component pins the cold-start contract: when
// getCurrentPlan reports a persisted plan, the atom MUST seed from filePath.
function PlanPathHydrationProbe({ subChatId }: { subChatId: string }) {
  const planPath = useAtomValue(currentPlanPathAtomFamily(subChatId));
  const setCurrentPlanPath = useSetAtom(currentPlanPathAtomFamily(subChatId));

  const { data: currentPlanData } = trpc.chats.getCurrentPlan.useQuery({ subChatId }, { enabled: !!subChatId });

  useEffect(() => {
    if (!planPath && currentPlanData?.exists && currentPlanData.filePath) {
      setCurrentPlanPath(currentPlanData.filePath);
    }
  }, [currentPlanData, planPath, setCurrentPlanPath]);

  return <div data-testid="plan-path">{planPath ?? 'EMPTY'}</div>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockGetCurrentPlan.mockReturnValue({ data: undefined });
});

describe('plan-path cold-start hydration', () => {
  test('atom stays empty when getCurrentPlan reports no persisted plan', () => {
    mockGetCurrentPlan.mockReturnValue({ data: { exists: false } });
    render(<PlanPathHydrationProbe subChatId="sc-empty" />);
    expect(screen.getByTestId('plan-path').textContent).toBe('EMPTY');
  });

  test('atom stays empty while the query is still loading', () => {
    mockGetCurrentPlan.mockReturnValue({ data: undefined });
    render(<PlanPathHydrationProbe subChatId="sc-loading" />);
    expect(screen.getByTestId('plan-path').textContent).toBe('EMPTY');
  });

  test('atom hydrates from filePath when getCurrentPlan reports a persisted plan', async () => {
    mockGetCurrentPlan.mockReturnValue({
      data: {
        exists: true,
        filePath: '/userData/sub-chats/sc-cold/plans/current.md',
        meta: { createdAt: new Date().toISOString() }
      }
    });

    await act(async () => {
      render(<PlanPathHydrationProbe subChatId="sc-cold" />);
    });

    expect(screen.getByTestId('plan-path').textContent).toBe('/userData/sub-chats/sc-cold/plans/current.md');
  });

  test('hydration does not clobber a planPath that is already set (builtin plan path takes precedence)', async () => {
    // First render: simulate a builtin plan path already seeded into the atom
    // (e.g. by agent-plan-file-tool). The MCP route also reports a plan, but
    // its filePath must not overwrite the in-progress builtin path.
    mockGetCurrentPlan.mockReturnValue({
      data: {
        exists: true,
        filePath: '/userData/sub-chats/sc-clash/plans/current.md',
        meta: { createdAt: new Date().toISOString() }
      }
    });

    function PrimedProbe() {
      const setCurrentPlanPath = useSetAtom(currentPlanPathAtomFamily('sc-clash'));
      useEffect(() => {
        setCurrentPlanPath('/repo/worktree-a/plans/plan-from-agent.md');
      }, [setCurrentPlanPath]);
      return <PlanPathHydrationProbe subChatId="sc-clash" />;
    }

    await act(async () => {
      render(<PrimedProbe />);
    });

    expect(screen.getByTestId('plan-path').textContent).toBe('/repo/worktree-a/plans/plan-from-agent.md');
  });
});
