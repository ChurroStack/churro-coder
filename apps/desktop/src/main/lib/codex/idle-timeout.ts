/**
 * Idle timeout for the codex app-server turn watcher.
 *
 * GPT-5 reasoning models can go silent for tens of seconds between visible
 * events while they think — especially at `high` effort — so the previous
 * fixed 60s budget was tripping on legitimate long reasoning and surfacing
 * the Continue button mid-turn. Scale the budget by the model's effort
 * suffix (e.g. `gpt-5.4/high`) and fall back to the safest (longest) value
 * when the suffix is missing or unrecognized, since `splitCodexModelAndEffort`
 * defaults to `high` semantics when no effort is encoded.
 */
const IDLE_TIMEOUT_BY_EFFORT_MS: Record<string, number> = {
  low: 60_000,
  medium: 120_000,
  high: 180_000
};

const DEFAULT_IDLE_TIMEOUT_MS = 180_000;

export function resolveCodexIdleTimeoutMs(modelId: string): number {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) return DEFAULT_IDLE_TIMEOUT_MS;
  const effort = modelId
    .slice(slashIdx + 1)
    .trim()
    .toLowerCase();
  if (!effort) return DEFAULT_IDLE_TIMEOUT_MS;
  return IDLE_TIMEOUT_BY_EFFORT_MS[effort] ?? DEFAULT_IDLE_TIMEOUT_MS;
}
