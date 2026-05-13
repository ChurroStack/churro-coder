import {
  init,
  captureException,
  captureMessage,
  captureFeedback,
  addBreadcrumb,
  getCurrentScope,
  setTag,
  browserTracingIntegration,
  consoleLoggingIntegration
} from '@sentry/electron/renderer';
import * as Sentry from '@sentry/electron/renderer';
import type { Event, ErrorEvent, EventHint } from '@sentry/electron/renderer';
import type { Log } from '@sentry/core';
import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { selectedAgentChatIdAtom } from '../features/agents/atoms';
import { useAgentSubChatStore } from '../features/agents/stores/sub-chat-store';
import { isDebugSession } from './debug-session';
import { snapshotChatEvents } from './chat-event-buffer';

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

function redactUnknown<T>(value: T): T {
  if (typeof value === 'string') {
    return redact(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactUnknown(item)])
    ) as T;
  }
  return value;
}

function sanitizeEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (isOptedOutLocal()) return null;
  attachChatEventContext(event as Event);
  return redactUnknown(event);
}

function attachChatEventContext(event: Event): void {
  const events = snapshotChatEvents();
  if (events.length === 0) return;
  event.contexts = {
    ...event.contexts,
    last_chat_events: {
      events,
      count: events.length
    }
  };
}

const ALWAYS_ALLOWED_LOG_LEVELS = new Set(['error', 'fatal']);

function sanitizeLogMessage(message: Log['message']): Log['message'] {
  return redactUnknown(message);
}

function sanitizeLogAttributes(attributes: Log['attributes']): Log['attributes'] {
  if (!attributes) return attributes;
  return redactUnknown(attributes);
}

export function sanitizeRendererLogForSend(log: Log): Log | null {
  if (import.meta.env.PROD && !isDebugSession() && !ALWAYS_ALLOWED_LOG_LEVELS.has(log.level)) {
    return null;
  }

  return {
    ...log,
    message: sanitizeLogMessage(log.message),
    attributes: sanitizeLogAttributes(log.attributes)
  };
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
    release: `churro-coder@${import.meta.env.VITE_APP_VERSION}`,
    sendDefaultPii: false,
    maxBreadcrumbs: 200,
    tracesSampler: () => (isDebugSession() ? 1.0 : import.meta.env.PROD ? 0.0 : 1.0),
    _experiments: { enableLogs: true },
    beforeSend: sanitizeEvent,
    beforeSendLog: sanitizeRendererLogForSend,
    beforeBreadcrumb(breadcrumb) {
      if (isOptedOutLocal()) return null;
      return breadcrumb;
    },
    integrations: [browserTracingIntegration(), consoleLoggingIntegration({ levels: ['warn', 'error'] })]
  });
  console.log('[Sentry] Renderer initialized', { environment: import.meta.env.PROD ? 'production' : 'development' });
}

export function useSentryWorkspaceTags(): void {
  const chatId = useAtomValue(selectedAgentChatIdAtom);
  const subChatId = useAgentSubChatStore((state) => state.activeSubChatId);

  useEffect(() => {
    const scope = getCurrentScope();
    scope.setTag('workspace_id', chatId ?? 'none');
    scope.setTag('subchat_id', subChatId ?? 'none');
    setTag('workspace_id', chatId ?? 'none');
    setTag('subchat_id', subChatId ?? 'none');
  }, [chatId, subChatId]);
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
  captureFeedback({ message }, includeContext ? undefined : undefined);
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
    const closePromise = Sentry.getClient()?.close?.(2000);
    if (closePromise) {
      await closePromise.then(undefined, () => {});
    }
  }
}
