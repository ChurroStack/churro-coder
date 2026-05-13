type OpsxCommand = 'propose' | 'apply' | 'verify' | 'archive';

const OPSX_RE = /^\/opsx:(propose|apply|verify|archive)(?:\s+(\S+))?([\s\S]*)$/;

/**
 * Expand an `/opsx:<cmd>` slash command into its full template.
 *
 * Returns the original prompt unchanged when it does not start with a
 * recognised `/opsx:` command (after leading whitespace is stripped).
 *
 * @param prompt            Raw user prompt, possibly with leading whitespace or a
 *                          `[step:…]` prefix already stripped by the caller.
 * @param openSpecChangePath Path to the change directory, or null.  Injected as
 *                          extra context only for `propose` commands.
 * @param renderTemplate    Callback that renders a built-in prompt template by key
 *                          (e.g. `"openspec/propose"`).  Injected so tests don't
 *                          need real template files on disk.
 */
export function expandOpsxCommand(
  prompt: string,
  openSpecChangePath: string | null,
  renderTemplate: (key: string) => string
): string {
  const match = prompt.trimStart().match(OPSX_RE);
  if (!match) return prompt;

  const [, cmd, arg = '', rest] = match as [string, OpsxCommand, string | undefined, string];
  const template = renderTemplate(`openspec/${cmd}`).replace(/\$ARGUMENTS/g, arg.trim());
  const parts: string[] = [template];

  if (cmd === 'propose' && openSpecChangePath) {
    parts.push(
      `The OpenSpec change directory already exists at \`${openSpecChangePath}\`. Continue the propose workflow for this change; do not create a different change.`
    );
  }

  const userText = rest.trim();
  if (userText) parts.push(userText);

  return parts.join('\n\n');
}
