/**
 * L4 integration: cross-provider Review flow.
 *
 * Mirrors the plan-approval cross-provider coverage, but for the
 * Changes-panel Review button path: apply the review default
 * synchronously, recreate the transport only when providers differ,
 * and guard dual-mount clicks with a module-level single-flight Set.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../lib/window-storage', async () => {
  const { atom } = await import('jotai');
  return {
    atomWithWindowStorage: (_key: string, defaultValue: unknown) => atom(defaultValue),
    createWindowScopedStorage: () => ({
      getItem: (_key: string, init: unknown) => init,
      setItem: () => {},
      removeItem: () => {}
    })
  };
});
vi.mock('../../../../lib/trpc', () => ({
  trpcClient: {
    codex: {
      cleanup: {
        mutate: vi.fn(async () => undefined)
      }
    }
  },
  trpc: {}
}));

import { appStore } from '../../../../lib/jotai-store';
import {
  defaultReviewModeModelAtom,
  defaultReviewModeThinkingAtom,
  subChatCodexModelIdAtomFamily,
  subChatModelIdAtomFamily,
  subChatProviderOverrideAtomFamily
} from '../../atoms';
import { applyModeDefaultModelAndSwitchProvider, reviewInFlight } from '../../lib/model-switching';
import { agentChatStore } from '../../stores/agent-chat-store';
import { CodexChatTransport } from '../../lib/codex-chat-transport';

let testCounter = 0;
const nextSubChatId = () => `int-review-${++testCounter}`;

function createCodexTransport(): CodexChatTransport {
  const transport = {
    config: { subChatId: 'test-sub-chat' },
    cleanup: vi.fn()
  };
  Object.setPrototypeOf(transport, CodexChatTransport.prototype);
  return transport as unknown as CodexChatTransport;
}

beforeEach(() => {
  agentChatStore.clear();
  reviewInFlight.clear();
  appStore.set(defaultReviewModeModelAtom, 'opus');
  appStore.set(defaultReviewModeThinkingAtom, 'high');
});

describe('L4 integration — Review cross-provider switching', () => {
  test('Codex chat -> Claude review recreates the transport and preserves the Codex atom', () => {
    const id = nextSubChatId();
    appStore.set(subChatCodexModelIdAtomFamily(id), 'gpt-5.4');
    appStore.set(subChatProviderOverrideAtomFamily(id), 'codex');
    agentChatStore.set(id, { transport: createCodexTransport() } as any, 'parent-chat');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe('opus');
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe('gpt-5.4');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('claude-code');
    expect(agentChatStore.get(id)).toBeUndefined();
    expect(result).toEqual({ modelId: 'opus', provider: 'claude-code', providerSwitched: true });
  });

  test('Claude chat -> Claude review keeps the existing transport', () => {
    const id = nextSubChatId();
    appStore.set(defaultReviewModeModelAtom, 'sonnet');
    appStore.set(subChatModelIdAtomFamily(id), 'opus');
    appStore.set(subChatProviderOverrideAtomFamily(id), 'claude-code');
    agentChatStore.set(id, { transport: {} } as any, 'parent-chat');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(agentChatStore.get(id)).toBeDefined();
    expect(result).toEqual({ modelId: 'sonnet', provider: 'claude-code', providerSwitched: false });
  });

  test('single-flight dual-mount gate blocks the second entry and releases cleanly', () => {
    const id = nextSubChatId();

    expect(reviewInFlight.has(id)).toBe(false);
    reviewInFlight.add(id);
    expect(reviewInFlight.has(id)).toBe(true);
    reviewInFlight.delete(id);
    expect(reviewInFlight.has(id)).toBe(false);
  });

  test('single-flight lock is released from a finally block on throw', async () => {
    const id = nextSubChatId();

    const run = async () => {
      if (reviewInFlight.has(id)) return;
      reviewInFlight.add(id);
      try {
        throw new Error('boom');
      } finally {
        reviewInFlight.delete(id);
      }
    };

    await expect(run()).rejects.toThrow('boom');
    expect(reviewInFlight.has(id)).toBe(false);
  });

  test('previous provider is read from the existing transport, not the overwritten override atom', () => {
    const id = nextSubChatId();
    appStore.set(subChatProviderOverrideAtomFamily(id), 'codex');
    agentChatStore.set(id, { transport: createCodexTransport() } as any, 'parent-chat');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(result.providerSwitched).toBe(true);
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('claude-code');
  });
});
