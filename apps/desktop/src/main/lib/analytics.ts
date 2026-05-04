// Analytics removed — all functions are no-ops.
// Argument types are intentionally `unknown` so callers can pass anything
// without fighting the no-op stubs.

export function initAnalytics(): void {}
export function identify(_userId: string, _traits?: unknown): void {}
export function capture(_eventName: string, _properties?: unknown): void {}
export function setSubscriptionPlan(_plan: string): void {}
export async function shutdown(): Promise<void> {}
export function setOptOut(_optedOut: boolean): void {}
export function isOptedOut(): boolean {
  return true;
}
export function trackAppOpened(): void {}
export function trackAuthCompleted(_userId: string, _email?: string): void {}
export function trackProjectOpened(_project: unknown): void {}
export function trackWorkspaceCreated(_workspace: unknown): void {}
export function trackChatStarted(_chat: unknown): void {}
export function trackMessageSent(_message: unknown): void {}
export function trackToolUsed(_tool: unknown): void {}
export function trackSettingsChanged(_settings: unknown): void {}
export function trackError(_error: unknown): void {}
export function setConnectionMethod(_method: string): void {}
export function trackPRCreated(_pr: unknown): void {}
export function trackWorkspaceArchived(_workspace: unknown): void {}
export function trackWorkspaceDeleted(_workspace: unknown): void {}
