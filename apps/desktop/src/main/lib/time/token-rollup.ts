/**
 * Token + cost rollup → `token_daily` (the spend half of the billing ledger).
 *
 * Reads the same Claude/Codex usage JSONLs the Usage dashboard uses and
 * attributes each entry to a PROJECT by its cwd (see project-resolver.ts), so
 * spend done in the user's own terminal still lands on the right project rather
 * than an "unattributed" bucket. When the session also matches a churro
 * sub-chat we keep its canonical chat/sub-chat names; otherwise the project name
 * is derived from the path. Buckets by (local day, attribution, provider, model).
 * Cost = provider costUSD when present, else priceFor(model); unknown models are
 * flagged `unpriced` (not silently $0).
 *
 * Full recompute (delete-all + reinsert in one transaction): re-attribution as
 * the project index changes must not double-count, so we rebuild rather than
 * upsert. Entries are read once by the caller (rollup.ts) and passed in.
 */
import { getDatabase } from '../db';
import { tokenDaily } from '../db/schema';
import { createId } from '../db/utils';
import { priceFor } from '../usage/pricing';
import { dedup, costForEntry } from '../usage/aggregator';
import type { UsageEntry } from '../usage/types';
import { resolveSession, type ProjectIndex, type SessionMap, type SessionIdentity } from './project-resolver';
import { localDateKey } from '../date-keys';

const TRACE = '[time-token]';

type Bucket = {
  identity: SessionIdentity;
  source: string;
  model: string;
  dateKey: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
  unpriced: boolean;
};

export function rollupTokenDaily(entries: UsageEntry[], index: ProjectIndex, sessionMap: SessionMap): void {
  try {
    const db = getDatabase();
    const deduped = dedup(entries);

    const buckets = new Map<string, Bucket>();
    for (const e of deduped) {
      const identity = resolveSession(e.sessionId ?? null, e.cwd ?? null, e.source, sessionMap, index);
      const dateKey = localDateKey(e.ts);
      const key = `${dateKey}|${identity.subChatId}|${e.source}|${e.model}`;
      const cost = costForEntry(e).cost;
      const b: Bucket = buckets.get(key) ?? {
        identity,
        source: e.source,
        model: e.model,
        dateKey,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costMicroUsd: 0,
        unpriced: false
      };
      b.inputTokens += e.inputTokens;
      b.outputTokens += e.outputTokens;
      b.cacheReadTokens += e.cacheReadTokens;
      b.cacheWriteTokens += e.cacheCreationTokens;
      if (cost === null) {
        b.unpriced = b.unpriced || priceFor(e.model) === null;
      } else {
        b.costMicroUsd += Math.round(cost * 1_000_000);
      }
      buckets.set(key, b);
    }

    const now = new Date();
    db.transaction((tx) => {
      tx.delete(tokenDaily).run();
      for (const b of buckets.values()) {
        tx.insert(tokenDaily)
          .values({
            id: createId(),
            dateKey: b.dateKey,
            projectId: b.identity.projectId,
            projectName: b.identity.projectName,
            chatId: b.identity.chatId,
            chatName: b.identity.chatName,
            subChatId: b.identity.subChatId,
            subChatName: b.identity.subChatName,
            harness: b.identity.harness,
            source: b.source,
            model: b.model,
            inputTokens: b.inputTokens,
            outputTokens: b.outputTokens,
            cacheReadTokens: b.cacheReadTokens,
            cacheWriteTokens: b.cacheWriteTokens,
            costMicroUsd: b.costMicroUsd,
            unpriced: b.unpriced,
            updatedAt: now
          })
          .run();
      }
    });
    console.log(`${TRACE} rolled up ${buckets.size} (day,attribution,model) bucket(s) from ${deduped.length} entries`);
  } catch (err) {
    console.warn(`${TRACE} rollupTokenDaily failed`, err);
  }
}
