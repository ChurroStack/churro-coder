/**
 * Returns true when the existing Claude Code session was started with a
 * different permissionMode than the current turn requests. The resumed session
 * JSONL encodes the original mode in its system instructions, so passing a new
 * permissionMode on resume does not override the agent's context. Forcing a
 * fresh session is the only way to guarantee the new mode takes full effect.
 */
export function shouldForceFreshSessionOnModeChange(args: {
  resumeSessionId: string | undefined
  existingSessionMode: "plan" | "agent" | null
  inputMode: "plan" | "agent"
}): boolean {
  return Boolean(
    args.resumeSessionId &&
      args.existingSessionMode &&
      args.existingSessionMode !== args.inputMode,
  )
}
