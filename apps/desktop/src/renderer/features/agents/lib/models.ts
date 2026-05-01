export type ClaudeThinkingLevel =
  | "off"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"

export const CLAUDE_MODELS = [
  {
    id: "opus",
    name: "Opus",
    version: "4.7",
    thinkings: ["off", "low", "medium", "high", "xhigh", "max"] as ClaudeThinkingLevel[],
  },
  {
    id: "opus[1m]",
    name: "Opus",
    version: "4.7 1M",
    thinkings: ["off", "low", "medium", "high", "xhigh", "max"] as ClaudeThinkingLevel[],
  },
  {
    id: "sonnet",
    name: "Sonnet",
    version: "4.6",
    thinkings: ["off", "low", "medium", "high"] as ClaudeThinkingLevel[],
  },
  {
    id: "sonnet[1m]",
    name: "Sonnet",
    version: "4.6 1M",
    thinkings: ["off", "low", "medium", "high"] as ClaudeThinkingLevel[],
  },
  {
    id: "haiku",
    name: "Haiku",
    version: "4.5",
    thinkings: ["off", "low", "medium", "high"] as ClaudeThinkingLevel[],
  },
]

export function formatClaudeThinkingLabel(thinking: ClaudeThinkingLevel): string {
  if (thinking === "off") return "Off"
  if (thinking === "xhigh") return "Extra High"
  if (thinking === "max") return "Max"
  return thinking.charAt(0).toUpperCase() + thinking.slice(1)
}

export type CodexThinkingLevel = "low" | "medium" | "high" | "xhigh"

export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    thinkings: ["low", "medium", "high"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.3-codex",
    name: "Codex 5.3",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "Codex 5.3 Spark",
    thinkings: ["low", "medium", "high"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.2-codex",
    name: "Codex 5.2",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.1-codex-max",
    name: "Codex 5.1 Max",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "Codex 5.1 Mini",
    thinkings: ["medium", "high"] as CodexThinkingLevel[],
  },
]

export function formatCodexThinkingLabel(thinking: CodexThinkingLevel): string {
  if (thinking === "xhigh") return "Extra High"
  return thinking.charAt(0).toUpperCase() + thinking.slice(1)
}

export function coerceCodexThinking(
  thinking: ClaudeThinkingLevel | "off" | "max",
  supported: readonly CodexThinkingLevel[],
): CodexThinkingLevel {
  const preferred = thinking === "max" ? "xhigh" : thinking === "off" ? "low" : thinking
  if (supported.includes(preferred as CodexThinkingLevel)) return preferred as CodexThinkingLevel
  if (supported.includes("high")) return "high"
  return supported[0] ?? "high"
}

export function formatModelLabel(rawId: string | undefined): string {
  if (!rawId) return ""
  const lower = rawId.toLowerCase()

  if (lower.startsWith("gpt-") || lower.includes("codex")) {
    const match = CODEX_MODELS.find((m) => lower === m.id.toLowerCase() || lower.startsWith(m.id.toLowerCase()))
    if (match) return match.name
    return rawId
  }

  const is1m = lower.includes("-1m") || lower.endsWith("1m")
  const families = [
    { keyword: "opus", modelId: is1m ? "opus[1m]" : "opus" },
    { keyword: "sonnet", modelId: is1m ? "sonnet[1m]" : "sonnet" },
    { keyword: "haiku", modelId: "haiku" },
  ]
  for (const family of families) {
    if (lower.includes(family.keyword)) {
      const model = CLAUDE_MODELS.find((m) => m.id === family.modelId)
      if (model) return `Claude ${model.name} ${model.version}`
    }
  }
  return rawId
}
