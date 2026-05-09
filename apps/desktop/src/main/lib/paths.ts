import { join } from 'node:path';

export function getAgentSessionsDir(userData: string): string {
  return join(userData, 'agent-sessions');
}

// Matches both the current name and the legacy name so historical tool-call
// message bodies (which still contain the old path) are recognised correctly.
export function isAppInternalSessionPath(filePath: string): boolean {
  return filePath.includes('agent-sessions') || filePath.includes('claude-sessions');
}
