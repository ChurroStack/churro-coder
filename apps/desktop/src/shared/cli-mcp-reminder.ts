/**
 * Single source of truth for the MCP-write-tool reminder injected into the
 * first user message of a CLI session. Both the main process (initial PTY
 * chunks in chats.buildCliBootstrap) and the renderer (useHarnessSendDispatcher)
 * read from here so the two injection points emit identical text.
 */
export const CLI_MCP_REMINDER = 'IMPORTANT: call write_plan before ExitPlanMode.';
