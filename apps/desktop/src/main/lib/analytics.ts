import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { PostHog } from 'posthog-node';

// Set POSTHOG_API_KEY env var at build time to enable telemetry.
// Without it the module is a no-op — safe to ship without a key.
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? '';
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let client: PostHog | null = null;
let deviceId: string | null = null;
let _optedOut = true; // strict opt-in: default to opted-out until user enables
// trackAppOpened is called from main/index.ts before posthog-node has loaded
// and before the renderer has synced the user's opt-out preference. We defer
// the actual fire until both gates pass and only fire once per session.
let appOpenedPending = false;
let appOpenedFired = false;

// Properties allowed to pass through to PostHog. Everything else is dropped.
const SAFE_KEYS = new Set([
  'app_version',
  'platform',
  'arch',
  'is_packaged',
  'provider',
  'model_id',
  'mode',
  'tool_name',
  'success',
  'error_type',
  'error_code',
  'setting_key',
  'message_count',
  'session_duration_ms',
  'page_name',
  'feature_name'
]);

function scrub(props?: Record<string, unknown>): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(SAFE_KEYS.has(k) || k.startsWith('$'))) continue;
    // SAFE_KEYS values are primitives by contract — a nested object on an
    // allowlisted key would smuggle arbitrary fields past the filter.
    const t = typeof v;
    if (v === null || v === undefined || t === 'string' || t === 'number' || t === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

function getDeviceId(): string {
  if (deviceId) return deviceId;
  const idPath = join(app.getPath('userData'), 'analytics-device-id.json');
  try {
    if (existsSync(idPath)) {
      const data = JSON.parse(readFileSync(idPath, 'utf8')) as { id?: string };
      if (typeof data.id === 'string' && data.id) {
        deviceId = data.id;
        return deviceId;
      }
    }
  } catch {}
  deviceId = randomUUID();
  try {
    writeFileSync(idPath, JSON.stringify({ id: deviceId }), 'utf8');
  } catch {}
  return deviceId;
}

function tryFireAppOpened(): void {
  if (!appOpenedPending || appOpenedFired) return;
  if (_optedOut || !client) return;
  appOpenedFired = true;
  try {
    client.capture({
      distinctId: getDeviceId(),
      event: 'app_opened',
      properties: scrub({
        app_version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        is_packaged: app.isPackaged
      })
    });
  } catch {}
}

// Returns a Promise so tests can await readiness; production callers can
// ignore the return value (the original `void` contract is preserved).
export function initAnalytics(): Promise<void> {
  if (!POSTHOG_API_KEY) return Promise.resolve();
  // Dynamic import keeps posthog-node out of the initial bundle parse.
  return import('posthog-node')
    .then(({ PostHog: PHClass }) => {
      client = new PHClass(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        flushAt: 20,
        flushInterval: 30_000
      });
      // Apply the current opt-out state. The renderer may have already
      // synced an opt-in via setOptOut() while we were loading; an
      // unconditional optOut() here would silently drop every event for
      // opted-in users.
      if (_optedOut) {
        client.optOut();
      } else {
        client.optIn();
      }
      tryFireAppOpened();
    })
    .catch(() => {});
}

export function setOptOut(optedOut: boolean): void {
  _optedOut = optedOut;
  if (client) {
    if (optedOut) {
      client.optOut();
    } else {
      client.optIn();
    }
  }
  tryFireAppOpened();
}

export function isOptedOut(): boolean {
  return _optedOut;
}

export function capture(eventName: string, properties?: Record<string, unknown>): void {
  if (_optedOut || !client) return;
  try {
    client.capture({
      distinctId: getDeviceId(),
      event: eventName,
      properties: scrub(properties)
    });
  } catch {}
}

export function identify(_userId: string, _traits?: unknown): void {
  // All events are device-scoped and anonymous — no user identity sent.
}

export function setSubscriptionPlan(_plan: string): void {}
export function setConnectionMethod(_method: string): void {}

export function trackAppOpened(): void {
  appOpenedPending = true;
  tryFireAppOpened();
}

export function trackAuthCompleted(_userId: string, _email?: string): void {
  capture('auth_completed', {});
}

export function trackProjectOpened(_project: unknown): void {
  capture('project_opened', {});
}

export function trackWorkspaceCreated(_workspace: unknown): void {
  capture('workspace_created', {});
}

export function trackChatStarted(_chat: unknown): void {
  capture('chat_started', {});
}

export function trackMessageSent(message: unknown): void {
  const m = message as { provider?: string; modelId?: string; mode?: string } | null;
  capture('message_sent', {
    provider: m?.provider,
    model_id: m?.modelId,
    mode: m?.mode
  });
}

export function trackToolUsed(tool: unknown): void {
  const t = tool as { name?: string; success?: boolean } | null;
  capture('tool_used', {
    tool_name: t?.name,
    success: t?.success
  });
}

export function trackSettingsChanged(settings: unknown): void {
  const s = settings as { key?: string } | null;
  capture('settings_changed', { setting_key: s?.key });
}

export function trackError(error: unknown): void {
  const e = error as { type?: string; code?: string } | null;
  capture('error_occurred', {
    error_type: e?.type,
    error_code: e?.code
  });
}

export function trackPRCreated(_pr: unknown): void {
  capture('pr_created', {});
}

export function trackWorkspaceArchived(_workspace: unknown): void {
  capture('workspace_archived', {});
}

export function trackWorkspaceDeleted(_workspace: unknown): void {
  capture('workspace_deleted', {});
}

export async function shutdown(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
