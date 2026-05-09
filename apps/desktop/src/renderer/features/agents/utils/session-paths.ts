// Renderer-side copy of the session-path helpers from src/main/lib/paths.ts.
// Do not import across the main↔renderer boundary; keep both copies identical.

// Matches both the current name and the legacy name so historical tool-call
// message bodies (which still contain the old path) are recognised correctly.
export function isAppInternalSessionPath(filePath: string): boolean {
  return filePath.includes('agent-sessions') || filePath.includes('claude-sessions');
}
