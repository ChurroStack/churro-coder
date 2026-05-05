import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  init,
  captureException,
  captureMessage,
  addBreadcrumb,
  close,
  getClient,
  electronContextIntegration,
  additionalContextIntegration,
  electronBreadcrumbsIntegration,
  normalizePathsIntegration
} from '@sentry/electron/main';
import type { Event } from '@sentry/electron/main';

const TELEMETRY_FILE = 'telemetry.json';

// Sentry DSN is a public identifier — safe to embed in shipped binaries.
// Override with MAIN_VITE_SENTRY_DSN env var for self-hosted forks.
const DEFAULT_SENTRY_DSN =
  'https://14d00a05791c7d015f24c50232a0336a@o4511333711282176.ingest.de.sentry.io/4511333717639248';

let optOutCached: boolean | null = null;
let sentryInitialized = false;

function getTelemetryPath(): string {
  return join(app.getPath('userData'), TELEMETRY_FILE);
}

function readOptOut(): boolean {
  if (optOutCached !== null) return optOutCached;
  try {
    const path = getTelemetryPath();
    if (!existsSync(path)) {
      optOutCached = false;
      return false;
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    optOutCached = data.optOut === true;
    return optOutCached;
  } catch {
    optOutCached = false;
    return false;
  }
}

const API_KEY_RE = /\b(sk-ant-[a-zA-Z0-9]{10,}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36}|Bearer\s+\S{20,})/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]{2,}@[a-zA-Z0-9.\-]{2,}\.[a-z]{2,}\b/g;

function redact(s: string): string {
  return s.replace(API_KEY_RE, '[KEY]').replace(EMAIL_RE, '[EMAIL]');
}

function sanitizeEvent(event: Event): Event | null {
  if (readOptOut()) return null;
  try {
    return JSON.parse(redact(JSON.stringify(event)));
  } catch {
    return event;
  }
}

export function initAnalytics(): void {
  if (sentryInitialized) return;
  const dsn = process.env.MAIN_VITE_SENTRY_DSN || DEFAULT_SENTRY_DSN;
  if (!dsn) return;

  sentryInitialized = true;

  init({
    dsn,
    enabled: !readOptOut(),
    environment: app.isPackaged ? 'production' : 'development',
    debug: !app.isPackaged,
    release: `churro-coder@${app.getVersion()}`,
    sendDefaultPii: false,
    beforeSend: sanitizeEvent,
    beforeBreadcrumb(breadcrumb) {
      if (readOptOut()) return null;
      return breadcrumb;
    },
    integrations: [
      electronContextIntegration(),
      additionalContextIntegration(),
      electronBreadcrumbsIntegration(),
      normalizePathsIntegration()
    ]
  });
  console.log('[Sentry] Main initialized', { environment: app.isPackaged ? 'production' : 'development' });
}

export function setOptOut(optedOut: boolean): void {
  optOutCached = optedOut;
  try {
    writeFileSync(getTelemetryPath(), JSON.stringify({ optOut: optedOut }));
  } catch (err) {
    console.warn('[Analytics] Failed to save telemetry preference:', err);
  }
  const client = getClient();
  if (client) {
    (client.getOptions() as any).enabled = !optedOut;
  }
}

export function isOptedOut(): boolean {
  return readOptOut();
}

export function identify(_userId: string, _traits?: unknown): void {}

export function capture(eventName: string, properties?: Record<string, unknown>): void {
  if (!sentryInitialized || readOptOut()) return;
  addBreadcrumb({
    category: 'app',
    message: eventName,
    data: properties,
    level: 'info',
    timestamp: Date.now() / 1000
  });
}

export function captureError(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!sentryInitialized || readOptOut()) return;
  if (error instanceof Error) {
    captureException(error, { data: context });
  } else {
    captureMessage(String(error), 'error');
  }
}

export async function shutdown(): Promise<void> {
  if (sentryInitialized) {
    await close(2000).catch(() => {});
  }
}

export function trackAppOpened(): void {
  capture('app.opened', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged
  });
}

export function trackAuthCompleted(_userId: string, _email?: string): void {
  capture('auth.completed');
}

export function trackProjectOpened(_project: unknown): void {
  capture('project.opened');
}

export function trackWorkspaceCreated(_workspace: unknown): void {
  capture('workspace.created');
}

export function trackChatStarted(chat: unknown): void {
  const c = chat as { mode?: string } | null;
  capture('chat.started', { mode: c?.mode });
}

export function trackMessageSent(message: unknown): void {
  const m = message as { role?: string; mode?: string; provider?: string } | null;
  capture('message.sent', { role: m?.role, mode: m?.mode, provider: m?.provider });
}

export function trackToolUsed(tool: unknown): void {
  const t = tool as { name?: string } | null;
  capture('tool.used', { name: t?.name });
}

export function trackSettingsChanged(settings: unknown): void {
  const s = settings as { key?: string } | null;
  capture('settings.changed', { key: s?.key });
}

export function trackError(error: unknown): void {
  captureError(error);
}

export function setConnectionMethod(_method: string): void {}

export function trackPRCreated(_pr: unknown): void {
  capture('pr.created');
}

export function trackWorkspaceArchived(_workspace: unknown): void {
  capture('workspace.archived');
}

export function trackWorkspaceDeleted(_workspace: unknown): void {
  capture('workspace.deleted');
}
