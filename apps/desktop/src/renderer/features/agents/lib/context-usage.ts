import { DEFAULT_CONTEXT_WINDOW, getModelContextWindow, isCodexModelId } from './models';

export type ContextUsageProvider = 'claude-code' | 'codex';

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
  sessionEpoch?: number;
}): MessageTokenData {
  const currentEpoch = Math.max(0, args.sessionEpoch ?? 0);
  const contextWindow = resolveContextWindow({
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

  const matchingMessage = [...args.messages].reverse().find((message) => {
    if (message.role !== 'assistant' || !message.metadata) return false;
    const provider = classifyProviderFromModel(message.metadata.model);
    if (provider !== args.selectedProvider) return false;
    const messageEpoch = Math.max(0, message.metadata.sessionEpoch ?? 0);
    if (messageEpoch < currentEpoch) return false;

    const metadata = message.metadata;
    return (
      metadata.inputTokens !== undefined ||
      metadata.outputTokens !== undefined ||
      metadata.totalTokens !== undefined ||
      metadata.cacheReadInputTokens !== undefined ||
      metadata.cacheCreationInputTokens !== undefined ||
      metadata.modelContextWindow !== undefined
    );
  });

  const metadata = matchingMessage?.metadata;
  const cacheReadInputTokens = metadata?.cacheReadInputTokens ?? 0;
  const cacheCreationInputTokens = metadata?.cacheCreationInputTokens ?? 0;
  const codexInputFallback =
    metadata?.totalTokens !== undefined ? Math.max(0, metadata.totalTokens - (metadata.outputTokens ?? 0)) : undefined;

  const totalInputTokens =
    args.selectedProvider === 'codex'
      ? (metadata?.inputTokens ?? codexInputFallback ?? 0) + cacheReadInputTokens
      : (metadata?.inputTokens ?? 0) + cacheReadInputTokens + cacheCreationInputTokens;

  return {
    totalInputTokens,
    totalOutputTokens: metadata?.outputTokens ?? 0,
    totalCostUsd: metadata?.totalCostUsd ?? 0,
    messageCount: args.messages.length,
    contextWindow: metadata?.modelContextWindow ?? contextWindow
  };
}
