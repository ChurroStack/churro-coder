import { isAbsolute, join, resolve, sep } from 'node:path';

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_MAX = 100;

/**
 * Folders inside `openspec/changes/archive/` are expected to look like
 * `2026-03-05-add-two-factor-auth`. The id portion follows the same kebab-case
 * rule as a regular change id.
 */
export const archivedFolderRegex = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface OpenSpecRoot {
  /** Absolute path to the directory containing `openspec/`. */
  rootDir: string;
  /** Absolute path to the `openspec/` directory itself. */
  openspecDir: string;
  /** `<openspecDir>/changes` */
  changesDir: string;
  /** `<openspecDir>/changes/archive` */
  archiveDir: string;
  /** `<openspecDir>/specs` */
  specsDir: string;
}

export function resolveRoot(rootDir: string): OpenSpecRoot {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new Error('rootDir must be a non-empty string');
  }
  if (!isAbsolute(rootDir)) {
    throw new Error(`rootDir must be absolute, got: ${rootDir}`);
  }
  if (rootDir.includes('\0')) {
    throw new Error('rootDir contains invalid characters');
  }
  const resolved = resolve(rootDir);
  const openspecDir = join(resolved, 'openspec');
  return {
    rootDir: resolved,
    openspecDir,
    changesDir: join(openspecDir, 'changes'),
    archiveDir: join(openspecDir, 'changes', 'archive'),
    specsDir: join(openspecDir, 'specs')
  };
}

function validateIdShape(id: string, label: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (id.length > ID_MAX) {
    throw new Error(`${label} too long (max ${ID_MAX} chars)`);
  }
  if (id.includes('/') || id.includes('\\')) {
    throw new Error(`${label} cannot contain path separators`);
  }
  if (id.includes('\0')) {
    throw new Error(`${label} contains invalid characters`);
  }
  if (id === '.' || id === '..' || id.startsWith('.')) {
    throw new Error(`${label} cannot start with a dot`);
  }
  if (!KEBAB_ID.test(id)) {
    throw new Error(`${label} must be kebab-case (lowercase letters, digits, hyphens)`);
  }
}

export function validateChangeId(id: string): void {
  validateIdShape(id, 'changeId');
}

export function validateCapabilityId(id: string): void {
  validateIdShape(id, 'capabilityId');
}

/**
 * Validates an archive folder name like `2026-03-05-add-two-factor-auth`.
 * Returns the parsed parts so callers don't have to re-parse.
 *
 * Rejects calendar-invalid dates (e.g. `2026-13-45`) — the YYYY-MM-DD prefix
 * must round-trip through `Date` parsing.
 */
export function parseArchivedFolder(folderName: string): { archivedAt: string; changeId: string } {
  const match = archivedFolderRegex.exec(folderName);
  if (!match) {
    throw new Error(`Invalid archive folder name: ${folderName}`);
  }
  const archivedAt = match[1]!;
  const parsed = new Date(`${archivedAt}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== archivedAt) {
    throw new Error(`Invalid archive folder date: ${archivedAt}`);
  }
  return { archivedAt, changeId: match[2]! };
}

/**
 * Ensures `targetPath` resolves inside `openspecDir`. Mirrors the pattern in
 * `routers/files.ts:validatePathSafe` but tightened to a single allowed parent.
 */
export function validateInsideOpenspec(targetPath: string, openspecDir: string): void {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  if (targetPath.includes('\0')) {
    throw new Error('Path contains invalid characters');
  }
  if (!isAbsolute(targetPath)) {
    throw new Error('Path must be absolute');
  }
  const resolved = resolve(targetPath);
  const resolvedParent = resolve(openspecDir);
  if (resolved !== resolvedParent && !resolved.startsWith(resolvedParent + sep)) {
    throw new Error('Path escapes openspec directory');
  }
}
