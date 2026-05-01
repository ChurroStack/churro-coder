export type CodexUsageMetadata = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  totalTokens?: number
  modelContextWindow?: number
  totalCostUsd?: number
}

// Prices per 1M tokens (USD). Strip the "/thinking" suffix to get the base model ID.
// Sources: OpenAI API pricing page (April 2026).
const CODEX_MODEL_PRICING: Record<
  string,
  { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number }
> = {
  "gpt-5.5":             { inputPer1M: 5.00,  cachedInputPer1M: 0.40,  outputPer1M: 30.00 },
  "gpt-5.4":             { inputPer1M: 2.50,  cachedInputPer1M: 0.25,  outputPer1M: 15.00 },
  "gpt-5.4-mini":        { inputPer1M: 0.75,  cachedInputPer1M: 0.075, outputPer1M:  4.50 },
  "gpt-5.3-codex":       { inputPer1M: 1.75,  cachedInputPer1M: 0.175, outputPer1M: 14.00 },
  "gpt-5.3-codex-spark": { inputPer1M: 1.75,  cachedInputPer1M: 0.175, outputPer1M: 14.00 },
  "gpt-5.2-codex":       { inputPer1M: 1.75,  cachedInputPer1M: 0.175, outputPer1M: 14.00 },
  "gpt-5.1-codex-max":   { inputPer1M: 1.25,  cachedInputPer1M: 0.125, outputPer1M: 10.00 },
  "gpt-5.1-codex-mini":  { inputPer1M: 0.25,  cachedInputPer1M: 0.025, outputPer1M:  2.00 },
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.trunc(value)
}

function readTokenCount(
  source: any,
  camelName: string,
  snakeName: string,
  ...alternateNames: string[]
): number | undefined {
  if (!source || typeof source !== "object") return undefined

  const names = [camelName, snakeName, ...alternateNames]
  for (const name of names) {
    const value = toNonNegativeInt(source[name])
    if (value !== undefined) return value
  }
  return undefined
}

function pickCodexTokenUsage(rawUsage: any): {
  usageRoot: any
  tokenUsage: any
} | null {
  if (!rawUsage || typeof rawUsage !== "object") return null

  const wrappedUsage =
    rawUsage.tokenUsage ||
    rawUsage.token_usage ||
    rawUsage.info ||
    rawUsage

  if (!wrappedUsage || typeof wrappedUsage !== "object") return null

  const tokenUsage =
    wrappedUsage.last ||
    wrappedUsage.lastTokenUsage ||
    wrappedUsage.last_token_usage ||
    wrappedUsage.total ||
    wrappedUsage.totalTokenUsage ||
    wrappedUsage.total_token_usage ||
    wrappedUsage

  if (!tokenUsage || typeof tokenUsage !== "object") return null

  return {
    usageRoot: wrappedUsage,
    tokenUsage,
  }
}

export function mapAppServerUsageToMetadata(
  rawUsage: unknown,
  modelId?: string,
): CodexUsageMetadata | null {
  if (!rawUsage || typeof rawUsage !== "object") {
    return null
  }

  const picked = pickCodexTokenUsage(rawUsage as any)
  if (!picked) return null

  const { usageRoot, tokenUsage } = picked
  const rawInputTokens = readTokenCount(
    tokenUsage,
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
  )
  const cachedInputTokens =
    readTokenCount(tokenUsage, "cachedInputTokens", "cached_input_tokens") ??
    0
  const inputTokens =
    rawInputTokens !== undefined
      ? Math.max(0, rawInputTokens - cachedInputTokens)
      : undefined
  const outputTokens =
    readTokenCount(
      tokenUsage,
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
    )
  const totalTokens =
    readTokenCount(tokenUsage, "totalTokens", "total_tokens") ??
    (rawInputTokens !== undefined || outputTokens !== undefined
      ? (rawInputTokens ?? 0) + (outputTokens ?? 0)
      : undefined)
  const modelContextWindow =
    readTokenCount(usageRoot, "modelContextWindow", "model_context_window") ??
    readTokenCount(rawUsage as any, "modelContextWindow", "model_context_window")

  const usageMetadata: CodexUsageMetadata = {}
  if (inputTokens !== undefined) usageMetadata.inputTokens = inputTokens
  if (outputTokens !== undefined) usageMetadata.outputTokens = outputTokens
  if (cachedInputTokens > 0) {
    usageMetadata.cacheReadInputTokens = cachedInputTokens
  }
  if (totalTokens !== undefined) usageMetadata.totalTokens = totalTokens
  if (modelContextWindow !== undefined) {
    usageMetadata.modelContextWindow = modelContextWindow
  }

  const baseModelId = modelId?.split("/")[0] ?? ""
  const pricing = CODEX_MODEL_PRICING[baseModelId]
  if (pricing && rawInputTokens !== undefined && outputTokens !== undefined) {
    const billableInput = Math.max(0, rawInputTokens - cachedInputTokens)
    usageMetadata.totalCostUsd =
      (billableInput * pricing.inputPer1M +
        cachedInputTokens * pricing.cachedInputPer1M +
        outputTokens * pricing.outputPer1M) /
      1_000_000
  }

  return Object.keys(usageMetadata).length > 0 ? usageMetadata : null
}
