/**
 * Single source of truth for the MCP-write-tool reminder injected into the
 * first user message of a CLI session. Both the main process (initial PTY
 * chunks in chats.buildCliBootstrap) and the renderer (useHarnessSendDispatcher)
 * call this so the two injection points emit identical text.
 *
 * Embeds the subChatId so the model receives the id even if it dropped the
 * --append-system-prompt context (Codex has no append-system-prompt; this is
 * its primary subChatId carrier).
 */
export function cliMcpReminder(subChatId: string): string {
  return `IMPORTANT: Pass subChatId: "${subChatId}" to every churro-coder MCP tool call. Call write_plan before ExitPlanMode.`;
}
