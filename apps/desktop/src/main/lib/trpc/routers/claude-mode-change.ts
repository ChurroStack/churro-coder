/**
 * Returns true when the existing Claude Code session was started with a
 * different permissionMode than the current turn requests. The resumed session
 * JSONL encodes the original mode in its system instructions, so passing a new
 * permissionMode on resume does not override the agent's context. Forcing a
 * fresh session is the only way to guarantee the new mode takes full effect.
 *
 * Also forces fresh when the client sends a sessionId (from message metadata)
 * but the DB has no active session — this covers the plan-approval flow where
 * handleApprovePlan explicitly nulls sessionId in the DB to signal "start fresh".
 */
export function shouldForceFreshSessionOnModeChange(args: {
  resumeSessionId: string | undefined
  existingSessionId: string | null
  existingSessionMode: "plan" | "agent" | null
  inputMode: "plan" | "agent"
}): boolean {
  // Mode mismatch: session was started in a different mode
  if (
    args.resumeSessionId &&
    args.existingSessionMode &&
    args.existingSessionMode !== args.inputMode
  ) {
    return true
  }
  // DB session cleared but client still has a session ID: DB wins, force fresh.
  // Covers plan-approval (exitPlan nulls sessionId) and any other explicit clear.
  if (args.resumeSessionId && !args.existingSessionId) {
    return true
  }
  return false
}
