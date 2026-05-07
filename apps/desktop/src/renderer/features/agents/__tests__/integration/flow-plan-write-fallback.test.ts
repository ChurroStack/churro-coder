import { describe, expect, test, vi } from 'vitest';
import { approvePlan, type PlanApprovalDeps } from '../../services/plan-approval-service';

describe('plan-write fallback flow', () => {
  test('approve persists recovered plan content before scheduling implement-plan send', async () => {
    const events: string[] = [];
    let persistedPlan: { subChatId: string; plan: { content: string; source?: string; title?: string } } | null = null;

    const deps: PlanApprovalDeps = {
      readPreviousProvider: () => 'codex',
      setMode: () => {
        events.push('setMode');
      },
      persistMode: async () => {
        events.push('persistMode');
      },
      applyDefaultModel: () => ({ provider: 'claude-code', isRemote: false }),
      notifyProviderChange: () => {
        events.push('notifyProviderChange');
      },
      resolvePlanContent: async () => ({
        content: '# Approved Plan\n\n1. Recover it',
        source: 'fallback:approve',
        title: 'Approved Plan'
      }),
      ensurePlanPersisted: async (input) => {
        persistedPlan = input;
        events.push('ensurePlanPersisted');
      },
      buildImplementPlanParts: () => [{ type: 'text', text: 'Implement plan' }],
      isInFlight: () => false,
      markInFlight: () => {},
      releaseInFlight: () => {},
      scheduleDeferredSend: () => {
        events.push('scheduleDeferredSend');
      }
    };

    const result = await approvePlan('fallback-1', deps);

    expect(result.ok).toBe(true);
    expect(persistedPlan).toEqual({
      subChatId: 'fallback-1',
      plan: {
        content: '# Approved Plan\n\n1. Recover it',
        source: 'fallback:approve',
        title: 'Approved Plan'
      }
    });
    expect(events).toEqual([
      'setMode',
      'persistMode',
      'notifyProviderChange',
      'ensurePlanPersisted',
      'scheduleDeferredSend'
    ]);
  });
});
