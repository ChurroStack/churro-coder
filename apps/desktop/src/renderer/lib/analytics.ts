// Analytics removed — all functions are no-ops

export async function initAnalytics(): Promise<void> {}
export function identify(_userId: string, _traits?: Record<string, any>): void {}
export function capture(_eventName: string, _properties?: Record<string, any>): void {}
export function setOptOut(_optedOut: boolean): void {}
export function isOptedOut(): boolean { return true }
export function trackPageView(_page: string): void {}
export function trackFeatureUsed(_feature: string, _properties?: Record<string, any>): void {}
export function trackMessageSent(_message: Record<string, any>): void {}
export async function shutdown(): Promise<void> {}
