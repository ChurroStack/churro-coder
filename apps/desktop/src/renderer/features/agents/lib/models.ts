export type ClaudeThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const CLAUDE_MODELS = [
  {
    id: 'opus',
    name: 'Opus',
    version: '4.8',
    contextWindow: 200_000,
    thinkings: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ClaudeThinkingLevel[]
  },
  {
    id: 'opus[1m]',
    name: 'Opus',
    version: '4.8 1M',
    contextWindow: 1_000_000,
    thinkings: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ClaudeThinkingLevel[]
  },
  {
    id: 'claude-opus-4-8',
    name: 'Opus',
    version: '4.8',
    contextWindow: 200_000,
    thinkings: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ClaudeThinkingLevel[]
  },
  {
    id: 'claude-opus-4-7',
    name: 'Opus',
    version: '4.7',
    contextWindow: 200_000,
    thinkings: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ClaudeThinkingLevel[]
  },
  {
    id: 'claude-opus-4-6',
    name: 'Opus',
    version: '4.6',
    contextWindow: 200_000,
    thinkings: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ClaudeThinkingLevel[]
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    version: '5',
    contextWindow: 200_000,
    thinkings: ['off', 'low', 'medium', 'high'] as ClaudeThinkingLevel[]
  },
  {
    id: 'sonnet[1m]',
    name: 'Sonnet',
    version: '5 1M',
    contextWindow: 1_000_000,
    thinkings: ['off', 'low', 'medium', 'high'] as ClaudeThinkingLevel[]
  },
  {
    id: 'haiku',
    name: 'Haiku',
    version: '4.5',
    contextWindow: 200_000,
    thinkings: ['off', 'low', 'medium', 'high'] as ClaudeThinkingLevel[]
  },
  {
    id: 'fable',
    name: 'Fable',
    version: '5',
    contextWindow: 1_000_000,
    thinkings: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ClaudeThinkingLevel[]
  }
];

// CLI-only model aliases surfaced in the Claude CLI window's model switcher
// (cli-prompt-bar). Kept OUT of CLAUDE_MODELS so they never leak into the
// builtin/settings model pickers — the builtin Agent SDK path can't honor
// `opusplan` (it's a Claude Code `/model` alias that switches opus↔sonnet by
// mode). Selecting one dispatches `/model <id>` into the CLI PTY.
export const CLI_MODEL_ALIASES = [
  {
    id: 'opusplan',
    name: 'Opus Plan',
    version: 'auto',
    contextWindow: 200_000,
    thinkings: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ClaudeThinkingLevel[]
  }
];

/**
 * Decide whether the Claude CLI should bootstrap on the `opusplan` alias.
 * Returns `'opusplan'` when the default Plan model is Opus AND the default
 * Execute model is Sonnet (either the plain or the 1M alias form) — there is
 * no `opusplan[1m]` alias, so the 1M Plan variant still maps to `opusplan`.
 * Returns `undefined` otherwise (bootstrap sends no `/model`).
 */
export function computeOpusplanCommand(planModel: string, executeModel: string): string | undefined {
  const isOpus = planModel === 'opus' || planModel === 'opus[1m]';
  const isSonnet = executeModel === 'sonnet' || executeModel === 'sonnet[1m]';
  return isOpus && isSonnet ? 'opusplan' : undefined;
}

export function formatClaudeThinkingLabel(thinking: ClaudeThinkingLevel): string {
  if (thinking === 'off') return 'Off';
  if (thinking === 'xhigh') return 'Extra High';
  if (thinking === 'max') return 'Max';
  return thinking.charAt(0).toUpperCase() + thinking.slice(1);
}

export type CodexThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export const CODEX_MODELS = [
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6-Sol',
    contextWindow: 372_000,
    thinkings: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as CodexThinkingLevel[]
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6-Terra',
    contextWindow: 372_000,
    thinkings: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as CodexThinkingLevel[]
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6-Luna',
    contextWindow: 372_000,
    thinkings: ['low', 'medium', 'high', 'xhigh', 'max'] as CodexThinkingLevel[]
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    contextWindow: 272_000,
    thinkings: ['low', 'medium', 'high', 'xhigh'] as CodexThinkingLevel[]
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    contextWindow: 272_000,
    thinkings: ['low', 'medium', 'high', 'xhigh'] as CodexThinkingLevel[]
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4-Mini',
    contextWindow: 272_000,
    thinkings: ['low', 'medium', 'high', 'xhigh'] as CodexThinkingLevel[]
  }
];

// Retired models — not shown in pickers but kept so stored prefs still resolve label/context.
export const CODEX_LEGACY_MODELS = [
  { id: 'gpt-5.3-codex', name: 'Codex 5.3', contextWindow: 400_000 },
  { id: 'gpt-5.3-codex-spark', name: 'Codex 5.3 Spark', contextWindow: 128_000 },
  { id: 'gpt-5.2-codex', name: 'Codex 5.2', contextWindow: 400_000 },
  { id: 'gpt-5.1-codex-max', name: 'Codex 5.1 Max', contextWindow: 400_000 },
  { id: 'gpt-5.1-codex-mini', name: 'Codex 5.1 Mini', contextWindow: 400_000 }
];

export const DEFAULT_CODEX_MODEL_ID = 'gpt-5.6-terra';
export const DEFAULT_CONTEXT_WINDOW = 200_000;

export function getDefaultCodexModel() {
  return CODEX_MODELS.find((model) => model.id === DEFAULT_CODEX_MODEL_ID) ?? CODEX_MODELS[0];
}

export function resolveCodexModel(modelId: string | undefined) {
  return CODEX_MODELS.find((model) => model.id === modelId) ?? getDefaultCodexModel();
}

export function getModelContextWindow(modelId: string | undefined): number | undefined {
  if (!modelId) return undefined;
  const normalizedId = modelId.trim().toLowerCase();
  const model = [...CLAUDE_MODELS, ...CLI_MODEL_ALIASES, ...CODEX_MODELS, ...CODEX_LEGACY_MODELS].find(
    (entry) => entry.id.toLowerCase() === normalizedId
  );
  return model?.contextWindow;
}

export function isCodexModelId(modelId: string | undefined): boolean {
  const normalized = modelId?.trim().toLowerCase() ?? '';
  return normalized.startsWith('gpt-') || normalized.includes('codex');
}

export function formatCodexThinkingLabel(thinking: CodexThinkingLevel): string {
  if (thinking === 'xhigh') return 'Extra High';
  if (thinking === 'max') return 'Max';
  if (thinking === 'ultra') return 'Ultra';
  return thinking.charAt(0).toUpperCase() + thinking.slice(1);
}

export function formatThinkingLabel(params: { model?: string; thinking?: string }): string {
  const rawThinking = params.thinking?.trim().toLowerCase();
  if (!rawThinking) return '';

  const rawModel = params.model?.trim().toLowerCase() || '';
  if (rawModel.startsWith('gpt-') || rawModel.includes('codex')) {
    if (['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(rawThinking)) {
      return formatCodexThinkingLabel(rawThinking as CodexThinkingLevel);
    }
  } else if (['off', 'low', 'medium', 'high', 'xhigh', 'max'].includes(rawThinking)) {
    return formatClaudeThinkingLabel(rawThinking as ClaudeThinkingLevel);
  }

  return rawThinking.charAt(0).toUpperCase() + rawThinking.slice(1);
}

export function coerceCodexThinking(
  thinking: ClaudeThinkingLevel | CodexThinkingLevel | 'off',
  supported: readonly CodexThinkingLevel[]
): CodexThinkingLevel {
  // Normalize 'off' → 'low', then fall through to the same coercion path
  const normalized: CodexThinkingLevel | ClaudeThinkingLevel = thinking === 'off' ? 'low' : thinking;
  // Prefer exact match when the model supports it
  if (supported.includes(normalized as CodexThinkingLevel)) return normalized as CodexThinkingLevel;
  // Graceful degradation for high-effort levels not supported by the model
  if (normalized === 'ultra') {
    if (supported.includes('max')) return 'max';
    if (supported.includes('xhigh')) return 'xhigh';
  }
  if (normalized === 'max' && supported.includes('xhigh')) return 'xhigh';
  if (supported.includes('high')) return 'high';
  return supported[0] ?? 'high';
}

export function formatModelLabel(rawId: string | undefined): string {
  if (!rawId) return '';
  const lower = rawId.toLowerCase();

  if (lower.startsWith('gpt-') || lower.includes('codex')) {
    const match = [...CODEX_MODELS, ...CODEX_LEGACY_MODELS].find(
      (m) => lower === m.id.toLowerCase() || lower.startsWith(m.id.toLowerCase())
    );
    if (match) return match.name;
    return rawId;
  }

  const exact = CLAUDE_MODELS.find((m) => m.id.toLowerCase() === lower);
  if (exact) return `Claude ${exact.name} ${exact.version}`;

  // CLI-only aliases (e.g. `opusplan`) may be stored as a CLI sub-chat's model.
  const alias = CLI_MODEL_ALIASES.find((m) => m.id.toLowerCase() === lower);
  if (alias) return `${alias.name} ${alias.version}`;

  const is1m = lower.includes('-1m') || lower.endsWith('1m');
  const families = [
    { keyword: 'opus', modelId: is1m ? 'opus[1m]' : 'opus' },
    { keyword: 'sonnet', modelId: is1m ? 'sonnet[1m]' : 'sonnet' },
    { keyword: 'haiku', modelId: 'haiku' }
  ];
  for (const family of families) {
    if (lower.includes(family.keyword)) {
      const model = CLAUDE_MODELS.find((m) => m.id === family.modelId);
      if (model) return `Claude ${model.name} ${model.version}`;
    }
  }
  return rawId;
}
