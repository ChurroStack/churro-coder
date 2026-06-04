/**
 * Re-export of the canonical compact relative-time formatter.
 * The implementation lives in `lib/utils/format-time-ago.ts`; this file exists
 * so the many `../utils/format-time-ago` imports inside the agents feature keep
 * resolving without churn. Do not reintroduce a separate copy here.
 */
export { formatTimeAgo } from '../../../lib/utils/format-time-ago';
