// Renderer-side analytics: all capture calls go through the main process via IPC.
// The main process owns the PostHog client and handles opt-out enforcement + scrubbing.

export async function initAnalytics(): Promise<void> {}

export function identify(_userId: string, _traits?: Record<string, any>): void {}

export function capture(eventName: string, properties?: Record<string, unknown>): void {
  window.desktopApi?.captureAnalytics?.(eventName, properties);
}

export function setOptOut(optedOut: boolean): void {
  window.desktopApi?.setAnalyticsOptOut(optedOut);
}

export function isOptedOut(): boolean {
  // Read directly from localStorage so this function is safe to call from
  // non-React contexts. Callers inside React should still prefer
  // analyticsOptOutAtom for reactivity.
  try {
    const stored = localStorage.getItem('preferences:analytics-opt-out');
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function trackPageView(page: string): void {
  capture('page_viewed', { page_name: page });
}

export function trackFeatureUsed(feature: string, properties?: Record<string, any>): void {
  capture('feature_used', { feature_name: feature, ...properties });
}

export function trackMessageSent(message: Record<string, any>): void {
  capture('message_sent', {
    provider: message?.provider,
    model_id: message?.modelId,
    mode: message?.mode
  });
}

export async function shutdown(): Promise<void> {}
