import { DEFAULT_CONTEXT_WINDOW, getModelContextWindow, isCodexModelId } from './models';

export type ContextUsageProvider = 'claude-code' | 'codex';

export type ContextUsageEpochs = Partial<Record<ContextUsageProvider, number>>;

type MessageLike = {
  role?: string;
  metadata?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    totalCostUsd?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    modelContextWindow?: number;
    sessionEpoch?: number;
  };
};

export type MessageTokenData = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  messageCount: number;
  contextWindow?: number;
  selectedContextWindow?: number;
  isStale?: boolean;
  staleReason?: 'cross-provider-fallback' | 'selected-model-mismatch';
};

export function classifyProviderFromModel(modelId: string | undefined): ContextUsageProvider {
  return isCodexModelId(modelId) ? 'codex' : 'claude-code';
}

export function resolveContextWindow(args: {
  modelId: string | undefined;
  metadataWindow: number | undefined;
}): number {
  const catalogWindow = getModelContextWindow(args.modelId);
  const metadataWindow = args.metadataWindow !== undefined && args.metadataWindow > 0 ? args.metadataWindow : undefined;
  return catalogWindow ?? metadataWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export function resolveContextUsage(args: {
  messages: MessageLike[];
  selectedProvider: ContextUsageProvider;
  selectedModelId?: string;
  /** @deprecated Pass per-provider epochs via sessionEpochs instead. */
  sessionEpoch?: number;
  sessionEpochs?: ContextUsageEpochs;
}): MessageTokenData {
  const epochFor = (provider: ContextUsageProvider): number =>
    Math.max(0, args.sessionEpochs?.[provider] ?? (args.selectedProvider === provider ? (args.sessionEpoch ?? 0) : 0));

  const currentEpochs: ContextUsageEpochs = {
    'claude-code': epochFor('claude-code'),
    codex: epochFor('codex')
  };
  const selectedContextWindow = resolveContextWindow({
    modelId: args.selectedModelId,
    metadataWindow: [...args.messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' &&
          classifyProviderFromModel(message.metadata?.model) === args.selectedProvider &&
          message.metadata?.modelContextWindow !== undefined
      )?.metadata?.modelContextWindow
  });

  const hasUsageOrContextMetadata = (metadata: MessageLike['metadata'] | undefined): boolean =>
    metadata !== undefined &&
    (metadata.inputTokens !== undefined ||
      metadata.outputTokens !== undefined ||
      metadata.totalTokens !== undefined ||
      metadata.cacheReadInputTokens !== undefined ||
      metadata.cacheCreationInputTokens !== undefined ||
      metadata.modelContextWindow !== undefined);

  const messageMatchesEpoch = (message: MessageLike): boolean => {
    const provider = classifyProviderFromModel(message.metadata?.model);
    const messageEpoch = Math.max(0, message.metadata?.sessionEpoch ?? 0);
    return messageEpoch >= (currentEpochs[provider] ?? 0);
  };

  const selectedProviderHistoryMessage = [...args.messages].reverse().find((message) => {
    if (message.role !== 'assistant' || !hasUsageOrContextMetadata(message.metadata)) return false;
    return classifyProviderFromModel(message.metadata.model) === args.selectedProvider;
  });

  const matchingMessage = [...args.messages].reverse().find((message) => {
    if (message.role !== 'assistant' || !hasUsageOrContextMetadata(message.metadata)) return false;
    const provider = classifyProviderFromModel(message.metadata.model);
    if (provider !== args.selectedProvider) return false;
    return messageMatchesEpoch(message);
  });

  // Search order:
  // 1. Latest selected-provider message still valid for that provider's current epoch.
  // 2. If the selected provider has any history at all, stop there so resets still zero the counter.
  // 3. Only when the selected provider has never emitted usage do we borrow the latest valid turn from another provider.
  const fallbackMessage =
    matchingMessage || selectedProviderHistoryMessage
      ? undefined
      : [...args.messages].reverse().find((message) => {
          if (message.role !== 'assistant' || !hasUsageOrContextMetadata(message.metadata)) return false;
          return messageMatchesEpoch(message);
        });

  const sourceMessage = matchingMessage ?? fallbackMessage;
  const metadata = sourceMessage?.metadata;
  const sourceProvider = metadata ? classifyProviderFromModel(metadata.model) : args.selectedProvider;
  const cacheReadInputTokens = metadata?.cacheReadInputTokens ?? 0;
  const cacheCreationInputTokens = metadata?.cacheCreationInputTokens ?? 0;
  const codexInputFallback =
    metadata?.totalTokens !== undefined ? Math.max(0, metadata.totalTokens - (metadata.outputTokens ?? 0)) : undefined;

  const totalInputTokens =
    sourceProvider === 'codex'
      ? (metadata?.inputTokens ?? codexInputFallback ?? 0) + cacheReadInputTokens
      : (metadata?.inputTokens ?? 0) + cacheReadInputTokens + cacheCreationInputTokens;

  const sourceContextWindow = metadata
    ? resolveContextWindow({
        modelId: metadata.model,
        metadataWindow: metadata.modelContextWindow
      })
    : selectedContextWindow;
  const isCrossProviderFallback = sourceMessage === fallbackMessage && sourceProvider !== args.selectedProvider;
  const isSelectedModelMismatch =
    !!metadata &&
    !isCrossProviderFallback &&
    sourceContextWindow !== undefined &&
    selectedContextWindow !== undefined &&
    sourceContextWindow !== selectedContextWindow;
  const contextWindow = isCrossProviderFallback ? selectedContextWindow : sourceContextWindow;

  return {
    totalInputTokens,
    totalOutputTokens: metadata?.outputTokens ?? 0,
    totalCostUsd: metadata?.totalCostUsd ?? 0,
    messageCount: args.messages.length,
    contextWindow,
    selectedContextWindow,
    isStale: isCrossProviderFallback || isSelectedModelMismatch,
    staleReason: isCrossProviderFallback ? 'cross-provider-fallback' : isSelectedModelMismatch ? 'selected-model-mismatch' : undefined
  };
}
