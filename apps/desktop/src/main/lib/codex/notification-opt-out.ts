import type { ServerNotification } from '../../../shared/codex-app-server-schema';

export const CODEX_APP_SERVER_OPT_OUT_NOTIFICATION_METHODS: Array<ServerNotification['method']> = [
  // Exact-match only. Keep this list to notifications we currently drop in
  // the router to avoid suppressing streamed turn data we actually consume.
  'fs/changed',
  'app/list/updated',
  'mcpServer/startupStatus/updated',
  'account/rateLimits/updated',
  'windowsSandbox/setupCompleted',
  'skills/changed'
];
