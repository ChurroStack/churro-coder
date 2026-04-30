export type Provider = "claude-code" | "codex"

const CLAUDE_MODEL_IDS = new Set([
  "opus",
  "opus[1m]",
  "sonnet",
  "sonnet[1m]",
  "haiku",
])

const CODEX_MODEL_IDS = new Set([
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
])

export function getProviderForModelId(modelId: string | undefined | null): Provider {
  if (!modelId) return "claude-code"
  if (CODEX_MODEL_IDS.has(modelId)) return "codex"
  if (CLAUDE_MODEL_IDS.has(modelId)) return "claude-code"
  // Heuristic fallback for unknown/legacy IDs
  if (modelId.includes("codex") || modelId.startsWith("gpt-")) return "codex"
  return "claude-code"
}
