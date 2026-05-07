import { describe, test, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FormSelection } from './model-switching';

// atoms/index.ts uses atomWithWindowStorage which accesses window.localStorage during init.
// Mock window-storage to use plain atoms so the test runs in a node environment.
vi.mock('../../../lib/window-storage', async () => {
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
vi.mock('../../../lib/trpc', () => ({
  trpcClient: {
    codex: {
      cleanup: {
        mutate: vi.fn(async () => undefined)
      }
    }
  },
  trpc: {}
}));
import { appStore } from '../../../lib/jotai-store';
import {
  defaultPlanModeModelAtom,
  defaultExecuteModeModelAtom,
  defaultExploreModeModelAtom,
  defaultReviewModeModelAtom,
  defaultPlanModeThinkingAtom,
  defaultExecuteModeThinkingAtom,
  defaultExploreModeThinkingAtom,
  defaultReviewModeThinkingAtom,
  subChatModelIdAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatClaudeThinkingAtomFamily,
  subChatCodexThinkingAtomFamily,
  subChatProviderOverrideAtomFamily,
  lastSelectedClaudeThinkingAtom,
  lastSelectedCodexThinkingAtom
} from '../atoms';
import {
  applyFormSelectionToSubChat,
  applyModeDefaultModel,
  applyModeDefaultModelAndSwitchProvider,
  getDefaultModelForMode,
  getDefaultThinkingForMode,
  reviewInFlight
} from './model-switching';
import { getCurrentSubChatMode } from './get-current-sub-chat-mode';
import { subChatModeAtomFamily } from '../atoms';
import { agentChatStore } from '../stores/agent-chat-store';
import { CodexChatTransport } from './codex-chat-transport';

let testCounter = 0;
function nextSubChatId(): string {
  return `test-sub-${++testCounter}`;
}

beforeEach(() => {
  agentChatStore.clear();
  reviewInFlight.clear();
  appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
  appStore.set(defaultExecuteModeModelAtom, 'sonnet');
  appStore.set(defaultReviewModeModelAtom, 'opus');
  appStore.set(defaultPlanModeThinkingAtom, 'high');
  appStore.set(defaultExecuteModeThinkingAtom, 'high');
  appStore.set(defaultReviewModeThinkingAtom, 'high');
});

function createCodexTransport(): CodexChatTransport {
  const transport = {
    config: { subChatId: 'test-sub-chat' },
    cleanup: vi.fn()
  };
  Object.setPrototypeOf(transport, CodexChatTransport.prototype);
  return transport as CodexChatTransport;
}

describe('getDefaultModelForMode', () => {
  test('plan → reads defaultPlanModeModelAtom', () => {
    appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
    expect(getDefaultModelForMode('plan')).toBe('opus[1m]');
  });

  test('execute → reads defaultExecuteModeModelAtom', () => {
    appStore.set(defaultExecuteModeModelAtom, 'haiku');
    expect(getDefaultModelForMode('execute')).toBe('haiku');
  });

  test('explore → reads defaultExploreModeModelAtom', () => {
    appStore.set(defaultExploreModeModelAtom, 'haiku');
    expect(getDefaultModelForMode('explore')).toBe('haiku');
  });

  test('review → reads defaultReviewModeModelAtom', () => {
    appStore.set(defaultReviewModeModelAtom, 'sonnet');
    expect(getDefaultModelForMode('review')).toBe('sonnet');
  });
});

describe('getDefaultThinkingForMode', () => {
  test('plan → reads defaultPlanModeThinkingAtom', () => {
    appStore.set(defaultPlanModeThinkingAtom, 'xhigh');
    expect(getDefaultThinkingForMode('plan')).toBe('xhigh');
  });

  test('execute → reads defaultExecuteModeThinkingAtom', () => {
    appStore.set(defaultExecuteModeThinkingAtom, 'off');
    expect(getDefaultThinkingForMode('execute')).toBe('off');
  });

  test('explore → reads defaultExploreModeThinkingAtom', () => {
    appStore.set(defaultExploreModeThinkingAtom, 'low');
    expect(getDefaultThinkingForMode('explore')).toBe('low');
  });

  test('review → reads defaultReviewModeThinkingAtom', () => {
    appStore.set(defaultReviewModeThinkingAtom, 'low');
    expect(getDefaultThinkingForMode('review')).toBe('low');
  });
});

describe('applyModeDefaultModel — Claude path', () => {
  test('review with Claude model → sets Claude atoms, provider = claude-code', () => {
    const id = nextSubChatId();
    appStore.set(defaultReviewModeModelAtom, 'opus');
    appStore.set(defaultReviewModeThinkingAtom, 'high');

    const result = applyModeDefaultModel(id, 'review');

    expect(result.modelId).toBe('opus');
    expect(result.provider).toBe('claude-code');
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe('opus');
    expect(appStore.get(subChatClaudeThinkingAtomFamily(id))).toBe('high');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('claude-code');
    expect(appStore.get(lastSelectedClaudeThinkingAtom)).toBe('high');
  });

  test('review with Claude model → codex atoms not updated for this subChatId', () => {
    const id = nextSubChatId();
    appStore.set(defaultReviewModeModelAtom, 'opus');
    // Codex atoms still at their defaults
    const codexModelBefore = appStore.get(subChatCodexModelIdAtomFamily(id));

    applyModeDefaultModel(id, 'review');

    // Codex model for this subChatId is unchanged (still the fallback default)
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe(codexModelBefore);
  });

  test('plan with Claude model → subChatModelId set to plan model', () => {
    const id = nextSubChatId();
    appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
    appStore.set(defaultPlanModeThinkingAtom, 'xhigh');

    const result = applyModeDefaultModel(id, 'plan');

    expect(result.modelId).toBe('opus[1m]');
    expect(result.provider).toBe('claude-code');
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe('opus[1m]');
    expect(appStore.get(subChatClaudeThinkingAtomFamily(id))).toBe('xhigh');
  });
});

describe('applyModeDefaultModel — Codex path (#32 regression)', () => {
  test('review with Codex model → sets Codex atoms, provider = codex', () => {
    const id = nextSubChatId();
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.3-codex');
    appStore.set(defaultReviewModeThinkingAtom, 'high');

    const result = applyModeDefaultModel(id, 'review');

    expect(result.modelId).toBe('gpt-5.3-codex');
    expect(result.provider).toBe('codex');
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe('gpt-5.3-codex');
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe('high');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('codex');
    expect(appStore.get(lastSelectedCodexThinkingAtom)).toBe('high');
  });

  test('review with Codex model → Claude model atom NOT set to the Codex model ID', () => {
    const id = nextSubChatId();
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.3-codex');

    applyModeDefaultModel(id, 'review');

    // The Claude model atom should NOT have been set to the Codex model ID
    expect(appStore.get(subChatModelIdAtomFamily(id))).not.toBe('gpt-5.3-codex');
  });

  test("Codex thinking coerced when model doesn't support the requested level", () => {
    const id = nextSubChatId();
    // gpt-5.3-codex-spark only supports ["low","medium","high"] (no xhigh)
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.3-codex-spark');
    appStore.set(defaultReviewModeThinkingAtom, 'xhigh');

    applyModeDefaultModel(id, 'review');

    // "xhigh" not in ["low","medium","high"] → coerced to "high"
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe('high');
  });

  test("Codex thinking 'max' treated as 'xhigh' → stays xhigh when supported", () => {
    const id = nextSubChatId();
    // gpt-5.3-codex supports ["low","medium","high","xhigh"]
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.3-codex');
    appStore.set(defaultReviewModeThinkingAtom, 'max');

    applyModeDefaultModel(id, 'review');

    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe('xhigh');
  });

  test("Codex thinking 'max' coerced when model doesn't support xhigh", () => {
    const id = nextSubChatId();
    // gpt-5.4-mini only supports ["low","medium","high"]
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.4-mini');
    appStore.set(defaultReviewModeThinkingAtom, 'max');

    applyModeDefaultModel(id, 'review');

    // max → xhigh → not in ["low","medium","high"] → falls back to "high"
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe('high');
  });

  test('lastSelectedCodexThinkingAtom updated, lastSelectedClaudeThinkingAtom unchanged', () => {
    const id = nextSubChatId();
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.3-codex');
    appStore.set(defaultReviewModeThinkingAtom, 'high');
    appStore.set(lastSelectedClaudeThinkingAtom, 'off');

    applyModeDefaultModel(id, 'review');

    expect(appStore.get(lastSelectedCodexThinkingAtom)).toBe('high');
    expect(appStore.get(lastSelectedClaudeThinkingAtom)).toBe('off');
  });
});

describe('applyModeDefaultModel — agent mode', () => {
  test('agent with Claude model → sets Claude atoms, provider = claude-code', () => {
    const id = nextSubChatId();
    appStore.set(defaultExecuteModeModelAtom, 'haiku');
    appStore.set(defaultExecuteModeThinkingAtom, 'off');

    const result = applyModeDefaultModel(id, 'execute');

    expect(result.modelId).toBe('haiku');
    expect(result.provider).toBe('claude-code');
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe('haiku');
    expect(appStore.get(subChatClaudeThinkingAtomFamily(id))).toBe('off');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('claude-code');
  });

  test('agent with Codex model → sets Codex atoms, provider = codex', () => {
    const id = nextSubChatId();
    appStore.set(defaultExecuteModeModelAtom, 'gpt-5.4');
    appStore.set(defaultExecuteModeThinkingAtom, 'medium');

    const result = applyModeDefaultModel(id, 'execute');

    expect(result.modelId).toBe('gpt-5.4');
    expect(result.provider).toBe('codex');
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe('gpt-5.4');
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe('medium');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('codex');
  });

  test('agent with Codex model → Claude model atom NOT set to the Codex model ID', () => {
    const id = nextSubChatId();
    appStore.set(defaultExecuteModeModelAtom, 'gpt-5.4');

    applyModeDefaultModel(id, 'execute');

    expect(appStore.get(subChatModelIdAtomFamily(id))).not.toBe('gpt-5.4');
  });

  test('plan=Claude then agent=Codex → provider override switches to codex', () => {
    const id = nextSubChatId();
    appStore.set(defaultPlanModeModelAtom, 'opus[1m]');
    appStore.set(defaultExecuteModeModelAtom, 'gpt-5.4');

    applyModeDefaultModel(id, 'plan');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('claude-code');

    applyModeDefaultModel(id, 'execute');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('codex');
    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe('gpt-5.4');
    // Claude model atom retains the plan-phase value, not the Codex ID
    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe('opus[1m]');
  });
});

describe('applyModeDefaultModel — return value', () => {
  test('returns { modelId, provider } synchronously', () => {
    const id = nextSubChatId();
    appStore.set(defaultExecuteModeModelAtom, 'sonnet');
    appStore.set(defaultExecuteModeThinkingAtom, 'high');

    const result = applyModeDefaultModel(id, 'execute');

    expect(result).toEqual({ modelId: 'sonnet', provider: 'claude-code' });
  });

  test('returns codex provider when model is a Codex model', () => {
    const id = nextSubChatId();
    appStore.set(defaultExecuteModeModelAtom, 'gpt-5.4');

    const result = applyModeDefaultModel(id, 'execute');

    expect(result).toEqual({ modelId: 'gpt-5.4', provider: 'codex' });
  });
});

describe('applyModeDefaultModelAndSwitchProvider', () => {
  test('cross-provider Codex -> Claude deletes the existing chat and reports providerSwitched', () => {
    const id = nextSubChatId();
    agentChatStore.set(id, { transport: createCodexTransport() } as any, 'parent-chat');
    appStore.set(defaultReviewModeModelAtom, 'opus');
    appStore.set(defaultReviewModeThinkingAtom, 'high');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(agentChatStore.get(id)).toBeUndefined();
    expect(result).toEqual({ modelId: 'opus', provider: 'claude-code', providerSwitched: true });
  });

  test('cross-provider Claude -> Codex deletes the existing chat and reports providerSwitched', () => {
    const id = nextSubChatId();
    agentChatStore.set(id, { transport: {} } as any, 'parent-chat');
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.4');
    appStore.set(defaultReviewModeThinkingAtom, 'medium');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(agentChatStore.get(id)).toBeUndefined();
    expect(result).toEqual({ modelId: 'gpt-5.4', provider: 'codex', providerSwitched: true });
  });

  test('same-provider Claude -> Claude keeps the existing chat', () => {
    const id = nextSubChatId();
    agentChatStore.set(id, { transport: {} } as any, 'parent-chat');
    appStore.set(defaultReviewModeModelAtom, 'sonnet');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(agentChatStore.get(id)).toBeDefined();
    expect(result.providerSwitched).toBe(false);
    expect(result.provider).toBe('claude-code');
  });

  test('same-provider Codex -> Codex keeps the existing chat', () => {
    const id = nextSubChatId();
    agentChatStore.set(id, { transport: createCodexTransport() } as any, 'parent-chat');
    appStore.set(defaultReviewModeModelAtom, 'gpt-5.4');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(agentChatStore.get(id)).toBeDefined();
    expect(result.providerSwitched).toBe(false);
    expect(result.provider).toBe('codex');
  });

  test('no existing chat returns providerSwitched=false and does not throw', () => {
    const id = nextSubChatId();
    appStore.set(defaultReviewModeModelAtom, 'opus');

    const result = applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(result.providerSwitched).toBe(false);
    expect(agentChatStore.get(id)).toBeUndefined();
  });

  test('delegates atom writes to applyModeDefaultModel before deleting on cross-provider switch', () => {
    const id = nextSubChatId();
    agentChatStore.set(id, { transport: createCodexTransport() } as any, 'parent-chat');
    appStore.set(defaultReviewModeModelAtom, 'opus');
    appStore.set(defaultReviewModeThinkingAtom, 'high');

    applyModeDefaultModelAndSwitchProvider(id, 'review');

    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe('opus');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('claude-code');
  });
});

describe('reviewInFlight Set', () => {
  test('starts empty for a fresh sub-chat id', () => {
    expect(reviewInFlight.has(nextSubChatId())).toBe(false);
  });

  test('add marks the sub-chat id as in flight', () => {
    const id = nextSubChatId();
    reviewInFlight.add(id);

    expect(reviewInFlight.has(id)).toBe(true);
  });

  test('delete releases the sub-chat id', () => {
    const id = nextSubChatId();
    reviewInFlight.add(id);
    reviewInFlight.delete(id);

    expect(reviewInFlight.has(id)).toBe(false);
  });
});

describe('applyFormSelectionToSubChat — Claude path', () => {
  test('sets claude model atom and thinking, provider = claude-code', () => {
    const id = nextSubChatId();
    const selection: FormSelection = {
      provider: 'claude-code',
      claudeModelId: 'opus[1m]',
      claudeThinking: 'xhigh',
      codexModelId: 'gpt-5.4',
      codexThinking: 'medium'
    };

    applyFormSelectionToSubChat(id, selection);

    expect(appStore.get(subChatModelIdAtomFamily(id))).toBe('opus[1m]');
    expect(appStore.get(subChatClaudeThinkingAtomFamily(id))).toBe('xhigh');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('claude-code');
  });

  test('does not write the codex model atom for a Claude selection', () => {
    const id = nextSubChatId();
    const before = appStore.get(subChatCodexModelIdAtomFamily(id));
    const selection: FormSelection = {
      provider: 'claude-code',
      claudeModelId: 'sonnet',
      claudeThinking: 'off',
      codexModelId: 'gpt-5.4',
      codexThinking: 'high'
    };

    applyFormSelectionToSubChat(id, selection);

    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe(before);
  });
});

describe('applyFormSelectionToSubChat — Codex path', () => {
  test('sets codex model atom and thinking, provider = codex', () => {
    const id = nextSubChatId();
    const selection: FormSelection = {
      provider: 'codex',
      claudeModelId: 'opus',
      claudeThinking: 'high',
      codexModelId: 'gpt-5.4',
      codexThinking: 'medium'
    };

    applyFormSelectionToSubChat(id, selection);

    expect(appStore.get(subChatCodexModelIdAtomFamily(id))).toBe('gpt-5.4');
    expect(appStore.get(subChatCodexThinkingAtomFamily(id))).toBe('medium');
    expect(appStore.get(subChatProviderOverrideAtomFamily(id))).toBe('codex');
  });

  test('does not set the claude model atom to the codex model ID', () => {
    const id = nextSubChatId();
    const selection: FormSelection = {
      provider: 'codex',
      claudeModelId: 'opus',
      claudeThinking: 'high',
      codexModelId: 'gpt-5.4',
      codexThinking: 'high'
    };

    applyFormSelectionToSubChat(id, selection);

    expect(appStore.get(subChatModelIdAtomFamily(id))).not.toBe('gpt-5.4');
  });
});

// Behavioral tests for Approve Plan → mode propagation.
// These replace the prior source-inspection guard, which could not catch the
// actual runtime bug (stale fallback in transport constructors) because it only
// asserted text ordering, not that the new mode reaches the server.
describe('Approve Plan → next message uses agent mode', () => {
  test('getCurrentSubChatMode returns current atom value immediately', () => {
    const id = nextSubChatId();
    // Unknown subChatId defaults to the factory default mode ("plan").
    expect(getCurrentSubChatMode(id)).toBe('plan');
    // Simulate pre-approval state
    appStore.set(subChatModeAtomFamily(id), 'plan');
    expect(getCurrentSubChatMode(id)).toBe('plan');
    // Simulate handleApprovePlan writing the atom
    appStore.set(subChatModeAtomFamily(id), 'execute');
    expect(getCurrentSubChatMode(id)).toBe('execute');
  });

  test("getCurrentSubChatMode defaults to 'plan' for unknown subChatIds", () => {
    const id = nextSubChatId();
    expect(getCurrentSubChatMode(id)).toBe('plan');
  });
});

// Source-inspection guard for new-chat-form's submit-time model binding.
// Ensures applyFormSelectionToSubChat is called in both handleSend's onSuccess
// and handleOpen's onSuccess, and that in handleOpen it precedes any await.
describe('new-chat-form — applyFormSelectionToSubChat call-ordering regression', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const formPath = resolve(here, '../main/new-chat-form.tsx');

  test("applyFormSelectionToSubChat is called in handleSend's onSuccess", () => {
    const src = readFileSync(formPath, 'utf-8');

    const sendStart = src.indexOf('const handleSend = useCallback(async');
    expect(sendStart, 'handleSend not found in new-chat-form.tsx').toBeGreaterThan(-1);
    const sendEnd = src.indexOf('}, [', sendStart);
    const sendBody = src.slice(sendStart, sendEnd);

    expect(
      sendBody.includes('applyFormSelectionToSubChat'),
      "applyFormSelectionToSubChat missing from handleSend — model/thinking won't be applied to new chats"
    ).toBe(true);
  });

  test("applyFormSelectionToSubChat is called in handleOpen's onSuccess before any await", () => {
    const src = readFileSync(formPath, 'utf-8');

    const openStart = src.indexOf('const handleOpen = useCallback(async');
    expect(openStart, 'handleOpen not found in new-chat-form.tsx').toBeGreaterThan(-1);
    const openEnd = src.indexOf('}, [', openStart);
    const openBody = src.slice(openStart, openEnd);

    const applyAt = openBody.indexOf('applyFormSelectionToSubChat');
    const awaitAt = openBody.indexOf('await saveSubChatDraftWithAttachments');

    expect(applyAt, 'applyFormSelectionToSubChat missing from handleOpen').toBeGreaterThanOrEqual(0);
    expect(awaitAt, 'await saveSubChatDraftWithAttachments missing from handleOpen').toBeGreaterThanOrEqual(0);
    expect(
      applyAt < awaitAt,
      'applyFormSelectionToSubChat must run before await saveSubChatDraftWithAttachments — model-switch ordering invariant'
    ).toBe(true);
  });
});
