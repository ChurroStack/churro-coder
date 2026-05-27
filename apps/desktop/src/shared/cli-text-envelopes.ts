/**
 * Strip Claude Code's slash-command envelope tags + our own MCP first-turn
 * reminder block from user-typed text. These are internal to the CLI's
 * JSONL serialization (the builtin SDK chat never sees them) and are noise
 * in the rendered transcript.
 *
 * Used by:
 *   - main/lib/cli-session/jsonl-mapper.ts (so newly-ingested rows are clean
 *     in the messages table)
 *   - renderer/features/agents/ui/cli-conversation-pane.tsx (so rows that
 *     were ingested before this filter shipped also render clean — no
 *     destructive migration needed)
 *
 * Tags removed (whole block including content):
 *   <local-command-caveat>...</local-command-caveat>
 *   <local-command-stdout>...</local-command-stdout>
 *   <local-command-stderr>...</local-command-stderr>
 *   <command-name>...</command-name>
 *   <command-message>...</command-message>
 *   <command-args>...</command-args>
 *
 * Plus: our own first-turn MCP reminder line (cliMcpReminder in
 * src/shared/cli-mcp-reminder.ts) — strip the single line that starts with
 * "IMPORTANT: Pass subChatId:" plus its trailing newline. The user's actual
 * prompt follows on the next line.
 */
export function stripClaudeCliEnvelopes(text: string): string {
  let s = text;
  s = s.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '');
  s = s.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '');
  s = s.replace(/<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g, '');
  s = s.replace(/<command-name>[\s\S]*?<\/command-name>/g, '');
  s = s.replace(/<command-message>[\s\S]*?<\/command-message>/g, '');
  s = s.replace(/<command-args>[\s\S]*?<\/command-args>/g, '');
  // Match the single-line reminder + trailing newline. Anchor manually:
  // `m` flag's `$` is end-of-line so a `\n` terminator is sufficient.
  s = s.replace(/(^|\n)IMPORTANT: Pass subChatId:[^\n]*\n?/, '$1');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}
