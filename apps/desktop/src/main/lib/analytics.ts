// Analytics removed — all functions are no-ops

export function initAnalytics(): void {}
export function identify(_userId: string, _traits?: Record<string, any>): void {}
export function capture(_eventName: string, _properties?: Record<string, any>): void {}
export function setSubscriptionPlan(_plan: string): void {}
export async function shutdown(): Promise<void> {}
export function setOptOut(_optedOut: boolean): void {}
export function isOptedOut(): boolean { return true }
export function trackAppOpened(): void {}
export function trackAuthCompleted(_userId: string, _email?: string): void {}
export function trackProjectOpened(_project: { id: string; name: string }): void {}
export function trackWorkspaceCreated(_workspace: { projectId: string; projectName: string; mode: string }): void {}
export function trackChatStarted(_chat: { projectId: string; mode: string }): void {}
export function trackMessageSent(_message: { projectId: string; mode: string; hasAttachments: boolean }): void {}
export function trackToolUsed(_tool: { name: string; projectId: string }): void {}
export function trackSettingsChanged(_settings: { key: string; value: string }): void {}
export function trackError(_error: { type: string; message: string; projectId?: string }): void {}
export function setConnectionMethod(_method: string): void {}
export function trackPRCreated(_pr: { projectId: string; url: string }): void {}
export function trackWorkspaceArchived(_workspace: { projectId: string }): void {}
export function trackWorkspaceDeleted(_workspace: { projectId: string }): void {}
