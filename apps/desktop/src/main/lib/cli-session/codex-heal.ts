/**
 * One-time heal for Codex CLI sub-chats ingested before the missing-`id` fix.
 *
 * Background: Codex `message` / `reasoning` response_items carry no `id` field,
 * and the old jsonl-mapper dropped every record without one — so pre-fix Codex
 * chats persisted ONLY their tool calls (which fall back to `call_id`). The
 * conversation rendered blank. The mapper now synthesizes a stable id, but
 * existing rows are already gutted, and a plain Refresh would append the
 * recovered prose AFTER the surviving tool rows (rows render in idx order),
 * scrambling the transcript.
 *
 * This walks every `codex-cli` sub-chat once, wipes its cached message rows, and
 * re-ingests the JSONL from byte 0 via `CliSessionIngester.rebuildFromScratch`,
 * restoring the full conversation in chronological order. The JSONL is the
 * source of truth, so rebuilding the render cache is non-destructive.
 *
 * Idempotency: guarded by a marker file under userData — NOT a DB migration, so
 * we sidestep the drizzle `_journal` timestamp / statement-breakpoint pitfalls
 * documented in AGENTS.md for a flag this simple. Runs at most once per install.
 */

import { existsSync } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../db';
import { subChats } from '../db/schema';
import { attachIngester } from './ingester';

const TRACE = '[codex-heal]';
const MARKER_BASENAME = 'codex-heal-v1.done';

function markerPath(): string {
  return join(app.getPath('userData'), MARKER_BASENAME);
}

async function healAlreadyDone(): Promise<boolean> {
  try {
    await access(markerPath());
    return true;
  } catch {
    return false;
  }
}

async function markHealDone(): Promise<void> {
  try {
    await writeFile(markerPath(), new Date().toISOString(), 'utf8');
  } catch (err) {
    // If we can't write the marker we may re-run next launch. Rebuild is
    // idempotent (deterministic re-ingest from the JSONL), so that's harmless.
    console.warn(`${TRACE} could not write marker err=${err}`);
  }
}

/**
 * Rebuild every Codex sub-chat's ingested messages from its JSONL, once. Safe to
 * call unconditionally at startup — no-ops after the first successful run.
 * Fire-and-forget at the call site; failures are non-fatal (the status-widget
 * Refresh remains the manual escape hatch).
 */
export async function runCodexHealIfNeeded(): Promise<void> {
  if (await healAlreadyDone()) return;

  const db = getDatabase();
  const rows = db
    .select({ id: subChats.id, cliSessionFile: subChats.cliSessionFile })
    .from(subChats)
    .where(eq(subChats.harness, 'codex-cli'))
    .all();

  let healed = 0;
  let skipped = 0;
  for (const row of rows) {
    // No transcript on disk (never spawned, or file deleted) — leave as-is.
    if (!row.cliSessionFile || !existsSync(row.cliSessionFile)) {
      skipped += 1;
      continue;
    }
    try {
      const ing = await attachIngester(row.id, 'codex-cli', row.cliSessionFile);
      const res = await ing.rebuildFromScratch();
      healed += 1;
      console.log(`${TRACE} rebuilt sub=${row.id} messages=${res.newMessageCount}`);
    } catch (err) {
      console.warn(`${TRACE} rebuild failed sub=${row.id} err=${err}`);
    }
  }

  await markHealDone();
  if (rows.length > 0) {
    console.log(`${TRACE} done codexChats=${rows.length} healed=${healed} skipped=${skipped}`);
  }
}
