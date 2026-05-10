import type { ServerNotification } from '../../../shared/codex-app-server-schema';

/**
 * Notifications we deliberately ask the Codex app-server to suppress on this
 * connection. The server matches each entry exactly — no wildcards, no
 * prefix matching — so adding a method we *do* consume in
 * `handleAppServerNotification` (`apps/desktop/src/main/lib/trpc/routers/codex.ts`)
 * will silently break that streaming path. When in doubt, leave it out: the
 * worst case of NOT opting out is a JSON.parse cycle per message.
 *
 * Each entry below is something the dispatcher provably ignores today and
 * that the server emits autonomously (no client request triggered it), so
 * keeping them off the wire saves both stdio bytes and renderer-adjacent
 * JSON.parse cycles (see commit 59cb1bf for prior OOM context).
 */
export const CODEX_APP_SERVER_OPT_OUT_NOTIFICATION_METHODS: Array<ServerNotification['method']> = [
  // File-watch events from `fs/watch` we never call.
  'fs/changed',

  // App / connector / skill catalog metadata.
  'app/list/updated',
  'skills/changed',

  // MCP server lifecycle the renderer doesn't subscribe to.
  'mcpServer/startupStatus/updated',
  'mcpServer/oauthLogin/completed',

  // Account / auth state — we drive login through the CLI subprocess and
  // poll status separately, so push notifications here are noise.
  'account/updated',
  'account/login/completed',
  'account/rateLimits/updated',

  // Thread metadata events. Thread starts are observed via the `thread/start`
  // request response, and we don't surface server-side name/status/closed
  // changes — those are local-first in our UI.
  'thread/started',
  'thread/closed',
  'thread/status/changed',
  'thread/name/updated',

  // Model routing / Windows-only / request-resolved acknowledgements we don't
  // act on.
  'model/rerouted',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
  'serverRequest/resolved'
];
