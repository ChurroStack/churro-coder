import {
  init,
  captureException,
  captureMessage,
  captureFeedback,
  addBreadcrumb,
  close,
  getClient,
  makeFetchTransport
} from '@sentry/browser';
import type { Event } from '@sentry/browser';

const OPT_OUT_KEY = 'preferences:analytics-opt-out';

// Sentry DSN is a public identifier — safe to embed in shipped binaries.
// Override with VITE_SENTRY_DSN env var for self-hosted forks.
const DEFAULT_SENTRY_DSN =
  'https://14d00a05791c7d015f24c50232a0336a@o4511333711282176.ingest.de.sentry.io/4511333717639248';

let sentryInitialized = false;

function isOptedOutLocal(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'true';
  } catch {
    return false;
  }
}

const API_KEY_RE = /\b(sk-ant-[a-zA-Z0-9]{10,}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36}|Bearer\s+\S{20,})/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]{2,}@[a-zA-Z0-9.\-]{2,}\.[a-z]{2,}\b/g;

function redact(s: string): string {
  return s.replace(API_KEY_RE, '[KEY]').replace(EMAIL_RE, '[EMAIL]');
}

function sanitizeEvent(event: Event): Event | null {
  if (isOptedOutLocal()) return null;
  try {
    return JSON.parse(redact(JSON.stringify(event)));
  } catch {
    return event;
  }
}

export async function initAnalytics(): Promise<void> {
  if (sentryInitialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN || DEFAULT_SENTRY_DSN;
  if (!dsn) return;

  sentryInitialized = true;

  init({
    dsn,
    enabled: !isOptedOutLocal(),
    environment: import.meta.env.PROD ? 'production' : 'development',
    debug: !import.meta.env.PROD,
    sendDefaultPii: false,
    transport: makeFetchTransport,
    beforeSend: sanitizeEvent,
    beforeBreadcrumb(breadcrumb) {
      if (isOptedOutLocal()) return null;
      return breadcrumb;
    }
  });
  console.log('[Sentry] Renderer initialized', { environment: import.meta.env.PROD ? 'production' : 'development' });
}

export function identify(_userId: string, _traits?: Record<string, any>): void {}

export function capture(eventName: string, properties?: Record<string, unknown>): void {
  if (!sentryInitialized || isOptedOutLocal()) return;
  addBreadcrumb({
    category: 'app',
    message: eventName,
    data: properties,
    level: 'info',
    timestamp: Date.now() / 1000
  });
}

export function captureRendererError(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!sentryInitialized || isOptedOutLocal()) return;
  if (error instanceof Error) {
    captureException(error, { data: context });
  } else {
    captureMessage(String(error), 'error');
  }
}

export function sendUserFeedback(message: string, includeContext: boolean): void {
  if (!sentryInitialized || isOptedOutLocal()) return;
  captureFeedback({ message }, includeContext ? undefined : { captureContext: false });
}

export function setOptOut(_optedOut: boolean): void {}

export function isOptedOut(): boolean {
  return isOptedOutLocal();
}

export function trackPageView(_page: string): void {}

export function trackFeatureUsed(feature: string, properties?: Record<string, any>): void {
  capture(`feature.${feature}`, properties);
}

export function trackMessageSent(message: Record<string, any>): void {
  capture('message.sent', {
    role: message.role,
    mode: message.mode,
    provider: message.provider
  });
}

export async function shutdown(): Promise<void> {
  if (sentryInitialized) {
    await close(2000).catch(() => {});
  }
}
