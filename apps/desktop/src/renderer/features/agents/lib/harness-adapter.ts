/**
 * Slash-command translation adapter for CLI harnesses.
 *
 * Translates (currentMode, requestedMode, currentModel, requestedModel) → composedPrefix.
 * The prefix is prepended to the user's prompt body before writing to the PTY.
 *
 * For `builtin` harness, always returns '' — mode/model changes go through the
 * agent API natively.
 *
 * For CLI harnesses:
 *   - Model change: `/model <requestedModel>` (claude-cli only; codex-cli ignores)
 *   - No meaningful change: empty prefix + `[harness-adapter] no-op` trace
 */

export type HarnessAdapterHarness = 'builtin' | 'claude-cli' | 'codex-cli';

interface BuildHarnessPrefixParams {
  harness: HarnessAdapterHarness;
  subChatId?: string;
  currentModel?: string | null;
  requestedModel?: string | null;
}

/**
 * Build the slash-command prefix to prepend before the prompt body for CLI harnesses.
 * Returns an empty string when no translation is needed (no-op case).
 */
export function buildHarnessPrefix({
  harness,
  subChatId = '',
  currentModel,
  requestedModel
}: BuildHarnessPrefixParams): string {
  if (harness === 'builtin') return '';

  const parts: string[] = [];

  // Model switch: claude-cli supports `/model <id>`; codex-cli does not
  if (requestedModel && requestedModel !== currentModel && harness === 'claude-cli') {
    parts.push(`/model ${requestedModel}`);
  }

  if (parts.length === 0) {
    console.log(`[harness-adapter] no-op subChat=${subChatId} harness=${harness}`);
    return '';
  }

  return parts.join('\n');
}
