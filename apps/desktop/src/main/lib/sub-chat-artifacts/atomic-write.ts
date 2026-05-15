/**
 * Atomic file write helper for sub-chat artifact stores.
 *
 * Writes to a temp file, fsyncs the file contents and the containing directory,
 * then renames to the final path so concurrent readers always see either the
 * old content or the new content — never a partial write — and a power loss
 * mid-write cannot leave the renamed entry pointing at unflushed data.
 * All artifact writes under <userData>/sub-chats/ must go through this helper.
 */

import { mkdir, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWriteArtifact(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${randomUUID()}.tmp`);

  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }

  await rename(tmp, path);

  // Fsync the directory so the rename is durable after a crash. On Windows
  // opening a directory for fsync is not supported, so we skip the dir-fsync
  // there — NTFS journals the rename and the body fsync above is sufficient.
  if (process.platform !== 'win32') {
    const dirHandle = await open(dir, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  }
}
