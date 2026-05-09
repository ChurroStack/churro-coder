import { describe, expect, it } from 'vitest';
import {
  classifyProviderFromModel,
  resolveContextUsage,
  resolveContextWindow,
  type ContextUsageProvider
} from './context-usage';

function assistantMessage(
  model: string | undefined,
  metadata: Record<string, number | string | undefined> = {}
): {
  role: 'assistant';
  metadata: Record<string, number | string | undefined>;
} {
  return {
    role: 'assistant',
    metadata: {
      model,
      ...metadata
    }
  };
}

function resolve(provider: ContextUsageProvider, messages: ReturnType<typeof assistantMessage>[], extra?: object) {
  return resolveContextUsage({
    messages,
    selectedProvider: provider,
    selectedModelId: provider === 'codex' ? 'gpt-5.5' : 'sonnet',
    ...extra
  });
}

describe('classifyProviderFromModel', () => {
  it.each([
    { model: 'gpt-5.5', provider: 'codex' },
    { model: 'gpt-5.3-codex', provider: 'codex' },
    { model: 'claude-sonnet-4-6', provider: 'claude-code' },
    { model: undefined, provider: 'claude-code' }
  ])('classifies $model as $provider', ({ model, provider }) => {
    expect(classifyProviderFromModel(model)).toBe(provider);
  });
});

describe('resolveContextWindow', () => {
  it('uses catalog windows for both providers', () => {
    expect(resolveContextWindow({ modelId: 'opus[1m]', metadataWindow: 400_000 })).toBe(1_000_000);
    expect(resolveContextWindow({ modelId: 'gpt-5.5', metadataWindow: 123_000 })).toBe(1_050_000);
  });

  it('falls back to metadata when the catalog has no entry', () => {
    expect(resolveContextWindow({ modelId: 'unknown-model', metadataWindow: 321_000 })).toBe(321_000);
  });

  it('falls back to default when neither catalog nor metadata can resolve', () => {
    expect(resolveContextWindow({ modelId: 'unknown-model', metadataWindow: undefined })).toBe(200_000);
  });

  it('uses metadata when modelId is undefined', () => {
    expect(resolveContextWindow({ modelId: undefined, metadataWindow: 300_000 })).toBe(300_000);
  });

  it('falls back to default when both inputs are undefined', () => {
    expect(resolveContextWindow({ modelId: undefined, metadataWindow: undefined })).toBe(200_000);
  });

  it('treats zero metadata as missing', () => {
    expect(resolveContextWindow({ modelId: 'unknown-model', metadataWindow: 0 })).toBe(200_000);
  });

  it('treats negative metadata as missing', () => {
    expect(resolveContextWindow({ modelId: undefined, metadataWindow: -1 })).toBe(200_000);
  });
});

describe('resolveContextUsage', () => {
  it('returns a fresh-session zero state for an empty message list', () => {
    const result = resolve('claude-code', []);
    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.messageCount).toBe(0);
    expect(result.contextWindow).toBe(200_000);
  });

  it('filters by selected provider when history is interleaved', () => {
    const messages = [
      assistantMessage('claude-sonnet-4-6', { inputTokens: 50_000 }),
      assistantMessage('gpt-5.5', { inputTokens: 80_000 }),
      assistantMessage('claude-sonnet-4-6', { inputTokens: 70_000 })
    ];

    expect(resolve('claude-code', messages).totalInputTokens).toBe(70_000);
    expect(resolve('codex', messages).totalInputTokens).toBe(80_000);
  });

  it('returns different results for the same messages when selectedProvider flips', () => {
    const messages = [
      assistantMessage('gpt-5.5', { inputTokens: 90_000 }),
      assistantMessage('claude-sonnet-4-6', { inputTokens: 30_000 })
    ];

    const claudeResult = resolve('claude-code', messages);
    const codexResult = resolve('codex', messages);

    expect(claudeResult.totalInputTokens).toBe(30_000);
    expect(codexResult.totalInputTokens).toBe(90_000);
    expect(claudeResult.contextWindow).toBe(200_000);
    expect(codexResult.contextWindow).toBe(1_050_000);
  });

  it('uses selected model for the denominator, not the last message model', () => {
    const result = resolveContextUsage({
      messages: [assistantMessage('claude-sonnet-4-6', { inputTokens: 150_000, modelContextWindow: 200_000 })],
      selectedProvider: 'claude-code',
      selectedModelId: 'opus[1m]',
      sessionEpoch: 0
    });

    expect(result.totalInputTokens).toBe(150_000);
    expect(result.contextWindow).toBe(200_000);
    expect(resolveContextWindow({ modelId: 'opus[1m]', metadataWindow: result.contextWindow })).toBe(1_000_000);
  });

  it('prefers the catalog window over a metadata fallback for the selected model', () => {
    expect(resolveContextWindow({ modelId: 'gpt-5.5', metadataWindow: 200_000 })).toBe(1_050_000);
  });

  it('sums Claude inputTokens, cacheReadInputTokens, and cacheCreationInputTokens', () => {
    const result = resolve('claude-code', [
      assistantMessage('claude-sonnet-4-6', {
        inputTokens: 30_000,
        cacheReadInputTokens: 10_000,
        cacheCreationInputTokens: 5_000,
        outputTokens: 4_000
      })
    ]);

    expect(result.totalInputTokens).toBe(45_000);
    expect(result.totalOutputTokens).toBe(4_000);
  });

  it('re-adds cached Codex input tokens when inputTokens is present', () => {
    const result = resolve('codex', [
      assistantMessage('gpt-5.5', {
        inputTokens: 60_000,
        cacheReadInputTokens: 20_000,
        outputTokens: 5_000
      })
    ]);

    expect(result.totalInputTokens).toBe(80_000);
    expect(result.totalOutputTokens).toBe(5_000);
  });

  it('falls back to totalTokens - outputTokens for legacy Codex metadata', () => {
    const result = resolve('codex', [
      assistantMessage('gpt-5.5', {
        totalTokens: 95_000,
        outputTokens: 15_000
      })
    ]);

    expect(result.totalInputTokens).toBe(80_000);
  });

  it('returns zero when Codex metadata is missing every token field', () => {
    const result = resolve('codex', [assistantMessage('gpt-5.5', { totalCostUsd: 0.01 })]);
    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
  });

  it('filters out older session epochs and returns a fresh-session zero state', () => {
    const result = resolve(
      'claude-code',
      [assistantMessage('claude-sonnet-4-6', { inputTokens: 90_000, sessionEpoch: 1 })],
      {
        sessionEpoch: 2
      }
    );

    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
  });

  it('includes only the current-epoch message when both epochs are present', () => {
    const messages = [
      assistantMessage('claude-sonnet-4-6', { inputTokens: 90_000, sessionEpoch: 1 }),
      assistantMessage('claude-sonnet-4-6', { inputTokens: 30_000, sessionEpoch: 2 })
    ];

    const result = resolve('claude-code', messages, { sessionEpoch: 2 });
    expect(result.totalInputTokens).toBe(30_000);
  });

  it('treats undefined message epochs as zero for reload compatibility', () => {
    const result = resolve('claude-code', [assistantMessage('claude-sonnet-4-6', { inputTokens: 42_000 })], {
      sessionEpoch: 0
    });

    expect(result.totalInputTokens).toBe(42_000);
  });

  it('does not let the Claude epoch filter out Codex messages', () => {
    const messages = [
      assistantMessage('claude-sonnet-4-6', { inputTokens: 50_000, sessionEpoch: 0 }),
      assistantMessage('gpt-5.5', { inputTokens: 90_000, sessionEpoch: 0 })
    ];

    const claudeAfterReset = resolve('claude-code', messages, { sessionEpoch: 5 });
    const codexUnchanged = resolve('codex', messages, { sessionEpoch: 0 });

    expect(claudeAfterReset.totalInputTokens).toBe(0);
    expect(codexUnchanged.totalInputTokens).toBe(90_000);
  });
});
