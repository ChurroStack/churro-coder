import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Recursively collect files under `dir` whose basename passes `accept`, pushing
 * absolute paths into `out`. Shared by the Claude and Codex usage readers (which
 * differ only in the filename predicate). Unreadable directories are skipped.
 */
export async function walkJsonlFiles(dir: string, out: string[], accept: (name: string) => boolean): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true, encoding: 'utf8' })) as Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name as string;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      await walkJsonlFiles(full, out, accept);
    } else if (entry.isFile() && accept(name)) {
      out.push(full);
    }
  }
}
