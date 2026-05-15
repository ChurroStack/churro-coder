/**
 * Sweeps orphaned .tmp files left by crashed atomic writes under
 * <userData>/sub-chats/ plans and reviews directories.
 *
 * Called once at app boot after migrations complete.
 */

import { app } from 'electron';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function sweepDir(dir: string): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.tmp')) continue;
    const path = join(dir, entry);
    try {
      await rm(path, { force: true });
      console.log(`[artifact-sweep] removed orphan ${path}`);
      removed++;
    } catch (err) {
      console.warn(`[artifact-sweep] failed to remove ${path}:`, err);
    }
  }
  return removed;
}

export async function sweepOrphanTmpFiles(): Promise<void> {
  const subChatsRoot = join(app.getPath('userData'), 'sub-chats');
  let subChatIds: string[];
  try {
    const entries = await readdir(subChatsRoot, { withFileTypes: true });
    subChatIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return; // No sub-chats directory yet — nothing to sweep
  }

  let total = 0;
  for (const id of subChatIds) {
    total += await sweepDir(join(subChatsRoot, id, 'plans'));
    total += await sweepDir(join(subChatsRoot, id, 'reviews'));
  }

  if (total > 0) {
    console.log(`[artifact-sweep] sweep complete removed=${total}`);
  }
}
