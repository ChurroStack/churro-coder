/**
 * Shared snippet appended to stateless-mode tool descriptions so the LLM
 * remembers to pass subChatId. Bound-mode handlers (per-subChat MCP server)
 * pass an empty string here since the id is closed over at factory time.
 */
export function subChatIdRequirementBlurb(boundSubChatId: string | undefined): string {
  if (boundSubChatId) return '';
  return 'You MUST pass subChatId, which the host app provides in the prompt context (look for "Sub-chat id: <value>").';
}

/**
 * Standard error payload returned by stateless MCP tools when the LLM forgot
 * to pass subChatId. The shape matches the SDK's `CallToolResult`.
 */
export const SUB_CHAT_ID_MISSING_ERROR = {
  content: [
    {
      type: 'text' as const,
      text: 'Error: subChatId is required. The host app provides it in the prompt context as "Sub-chat id: <value>" — pass that value as the subChatId argument.'
    }
  ],
  isError: true as const
};
