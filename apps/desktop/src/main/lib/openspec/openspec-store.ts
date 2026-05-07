/**
 * Filesystem-backed OpenSpec store for churro-coder.
 *
 * Reads and writes the standard OpenSpec layout (proposal.md / tasks.md /
 * design.md / delta specs / current specs) under `<rootDir>/openspec/`. No
 * `openspec` CLI or library is involved — parsing is structural markdown only.
 *
 * The store is consumed by `routers/openspec.ts`, which is responsible for
 * resolving `rootDir` from chat/project context (worktree-first, project
 * fallback). The pure functions here have no awareness of chats or projects.
 *
 * Atomic writes follow the same temp-rename pattern as `plans/plan-store.ts`.
 */

import { shell } from 'electron';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ArchivedChangeSummary,
  CapabilityFileKind,
  CapabilitySummary,
  ChangeFileKind,
  ChangeSummary,
  DeltaSpec,
  FileContent,
  ProjectContext
} from './types';
import {
  parseArchivedFolder,
  resolveRoot,
  validateCapabilityId,
  validateChangeId,
  validateInsideOpenspec
} from './paths';
import { parseProposalMetadata } from './proposal-metadata';
import { parseDeltaSpec } from './delta-parser';
import { parseTaskProgress } from './tasks-parser';

const FILE_BASENAMES: Record<ChangeFileKind, string> = {
  proposal: 'proposal.md',
  tasks: 'tasks.md',
  design: 'design.md'
};

const CAPABILITY_FILE_BASENAMES: Record<CapabilityFileKind, string> = {
  spec: 'spec.md',
  design: 'design.md'
};

function isErrnoNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch (err) {
    if (isErrnoNotFound(err)) return false;
    throw err;
  }
}

async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf8');
  } catch (err) {
    if (isErrnoNotFound(err)) return null;
    throw err;
  }
}

async function readFileWithMtimeOrNull(absPath: string): Promise<FileContent | null> {
  try {
    const [content, st] = await Promise.all([readFile(absPath, 'utf8'), stat(absPath)]);
    return { content, modifiedAt: st.mtime.toISOString() };
  } catch (err) {
    if (isErrnoNotFound(err)) return null;
    throw err;
  }
}

/**
 * Atomic write: write to a randomly-named temp file in the same directory,
 * then `rename` over the destination. Same pattern as `plans/plan-store.ts:52`.
 */
async function atomicWrite(absPath: string, content: string): Promise<void> {
  const dir = dirname(absPath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, absPath);
}

async function listSubdirectories(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (isErrnoNotFound(err)) return [];
    throw err;
  }
}

/**
 * Walk a directory and return the most recent mtime found, including the
 * directory itself. Used to populate `modifiedAt` on change summaries.
 */
async function mostRecentMtime(absPath: string): Promise<string> {
  let latest = 0;
  async function walk(p: string): Promise<void> {
    let st;
    try {
      st = await stat(p);
    } catch (err) {
      if (isErrnoNotFound(err)) return;
      throw err;
    }
    if (st.mtimeMs > latest) latest = st.mtimeMs;
    if (st.isDirectory()) {
      let entries;
      try {
        entries = await readdir(p, { withFileTypes: true });
      } catch (err) {
        if (isErrnoNotFound(err)) return;
        throw err;
      }
      for (const entry of entries) {
        await walk(join(p, entry.name));
      }
    }
  }
  await walk(absPath);
  return new Date(latest).toISOString();
}

// ============================================================================
// init / introspection
// ============================================================================

export async function isInitialized(rootDir: string): Promise<boolean> {
  const { openspecDir } = resolveRoot(rootDir);
  return pathExists(openspecDir);
}

// ============================================================================
// changes (active)
// ============================================================================

async function buildChangeSummary(changesDir: string, openspecDir: string, changeId: string): Promise<ChangeSummary> {
  const changePath = join(changesDir, changeId);
  validateInsideOpenspec(changePath, openspecDir);

  const [proposalRaw, tasksRaw, designExists, capabilities, modifiedAt] = await Promise.all([
    readFileOrNull(join(changePath, 'proposal.md')),
    readFileOrNull(join(changePath, 'tasks.md')),
    pathExists(join(changePath, 'design.md')),
    listSubdirectories(join(changePath, 'specs')),
    mostRecentMtime(changePath)
  ]);

  const summary: ChangeSummary = {
    changeId,
    path: changePath,
    hasProposal: proposalRaw !== null,
    hasTasks: tasksRaw !== null,
    hasDesign: designExists,
    capabilities: capabilities.sort(),
    modifiedAt
  };

  if (proposalRaw !== null) {
    summary.proposal = parseProposalMetadata(changeId, proposalRaw);
  }
  if (tasksRaw !== null) {
    summary.taskProgress = parseTaskProgress(tasksRaw);
  }

  return summary;
}

export async function listChanges(rootDir: string): Promise<ChangeSummary[]> {
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const folders = await listSubdirectories(changesDir);
  // `archive` is a reserved subfolder, not a change.
  const changeIds = folders.filter((name) => name !== 'archive');

  const summaries = await Promise.all(
    changeIds.map(async (id) => {
      try {
        // Validate that the folder name is a legal change id; skip otherwise.
        validateChangeId(id);
      } catch {
        return null;
      }
      return buildChangeSummary(changesDir, openspecDir, id);
    })
  );

  return summaries
    .filter((s): s is ChangeSummary => s !== null)
    .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
}

export async function readChange(rootDir: string, changeId: string): Promise<ChangeSummary | null> {
  validateChangeId(changeId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const changePath = join(changesDir, changeId);
  validateInsideOpenspec(changePath, openspecDir);
  if (!(await pathExists(changePath))) return null;
  return buildChangeSummary(changesDir, openspecDir, changeId);
}

export async function readChangeFile(
  rootDir: string,
  changeId: string,
  kind: ChangeFileKind
): Promise<FileContent | null> {
  validateChangeId(changeId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const filePath = join(changesDir, changeId, FILE_BASENAMES[kind]);
  validateInsideOpenspec(filePath, openspecDir);
  return readFileWithMtimeOrNull(filePath);
}

export async function writeChangeFile(
  rootDir: string,
  changeId: string,
  kind: ChangeFileKind,
  content: string
): Promise<void> {
  validateChangeId(changeId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const filePath = join(changesDir, changeId, FILE_BASENAMES[kind]);
  validateInsideOpenspec(filePath, openspecDir);
  await atomicWrite(filePath, content);
  console.log(`[openspec] writeChangeFile change=${changeId} kind=${kind} bytes=${Buffer.byteLength(content, 'utf8')}`);
}

export async function createChange(
  rootDir: string,
  changeId: string,
  files: { proposal?: string; tasks?: string; design?: string }
): Promise<void> {
  validateChangeId(changeId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const changePath = join(changesDir, changeId);
  validateInsideOpenspec(changePath, openspecDir);

  if (await pathExists(changePath)) {
    throw new Error(`Change already exists: ${changeId}`);
  }

  await mkdir(changePath, { recursive: true });

  // Write whichever files were provided. `createChange` is not transactional —
  // a partial scaffold is recoverable since the user can call writeChangeFile
  // for the rest. (Same trade-off documented in plans/plan-store.ts:49-51.)
  const writes: Array<Promise<void>> = [];
  if (files.proposal !== undefined) {
    writes.push(atomicWrite(join(changePath, FILE_BASENAMES.proposal), files.proposal));
  }
  if (files.tasks !== undefined) {
    writes.push(atomicWrite(join(changePath, FILE_BASENAMES.tasks), files.tasks));
  }
  if (files.design !== undefined) {
    writes.push(atomicWrite(join(changePath, FILE_BASENAMES.design), files.design));
  }
  await Promise.all(writes);
  console.log(`[openspec] createChange change=${changeId} files=${Object.keys(files).join(',') || 'none'}`);
}

export async function deleteChange(rootDir: string, changeId: string): Promise<void> {
  validateChangeId(changeId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const changePath = join(changesDir, changeId);
  validateInsideOpenspec(changePath, openspecDir);
  if (!(await pathExists(changePath))) {
    throw new Error(`Change not found: ${changeId}`);
  }
  // Soft-delete via OS trash (mirrors `routers/files.ts:deleteFile`).
  await shell.trashItem(changePath);
  console.log(`[openspec] deleteChange change=${changeId}`);
}

// ============================================================================
// change deltas (specs/ inside a change)
// ============================================================================

export async function listChangeDeltas(
  rootDir: string,
  changeId: string
): Promise<{ capabilityId: string; path: string }[]> {
  validateChangeId(changeId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const specsDir = join(changesDir, changeId, 'specs');
  validateInsideOpenspec(specsDir, openspecDir);
  const folders = await listSubdirectories(specsDir);
  return folders
    .filter((name) => {
      try {
        validateCapabilityId(name);
        return true;
      } catch {
        return false;
      }
    })
    .map((capabilityId) => ({ capabilityId, path: join(specsDir, capabilityId, 'spec.md') }))
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}

export async function readChangeDelta(
  rootDir: string,
  changeId: string,
  capabilityId: string
): Promise<{ content: string; modifiedAt: string; parsed: DeltaSpec | null } | null> {
  validateChangeId(changeId);
  validateCapabilityId(capabilityId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const filePath = join(changesDir, changeId, 'specs', capabilityId, 'spec.md');
  validateInsideOpenspec(filePath, openspecDir);
  const file = await readFileWithMtimeOrNull(filePath);
  if (file === null) return null;

  let parsed: DeltaSpec | null = null;
  try {
    parsed = parseDeltaSpec(capabilityId, file.content);
  } catch (err) {
    console.warn(
      `[openspec] readChangeDelta parse failed change=${changeId} capability=${capabilityId}: ${(err as Error).message}`
    );
  }
  return { content: file.content, modifiedAt: file.modifiedAt, parsed };
}

export async function writeChangeDelta(
  rootDir: string,
  changeId: string,
  capabilityId: string,
  content: string
): Promise<void> {
  validateChangeId(changeId);
  validateCapabilityId(capabilityId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const filePath = join(changesDir, changeId, 'specs', capabilityId, 'spec.md');
  validateInsideOpenspec(filePath, openspecDir);
  await atomicWrite(filePath, content);
  console.log(
    `[openspec] writeChangeDelta change=${changeId} capability=${capabilityId} bytes=${Buffer.byteLength(content, 'utf8')}`
  );
}

export async function deleteChangeDelta(rootDir: string, changeId: string, capabilityId: string): Promise<void> {
  validateChangeId(changeId);
  validateCapabilityId(capabilityId);
  const { changesDir, openspecDir } = resolveRoot(rootDir);
  const folderPath = join(changesDir, changeId, 'specs', capabilityId);
  validateInsideOpenspec(folderPath, openspecDir);
  if (!(await pathExists(folderPath))) {
    throw new Error(`Delta not found: ${capabilityId} in change ${changeId}`);
  }
  await shell.trashItem(folderPath);
  console.log(`[openspec] deleteChangeDelta change=${changeId} capability=${capabilityId}`);
}

// ============================================================================
// archived changes (read-only)
// ============================================================================

async function buildArchivedSummary(
  archiveDir: string,
  openspecDir: string,
  archiveFolder: string
): Promise<ArchivedChangeSummary | null> {
  let parsedFolder: { archivedAt: string; changeId: string };
  try {
    parsedFolder = parseArchivedFolder(archiveFolder);
  } catch {
    return null;
  }

  const folderPath = join(archiveDir, archiveFolder);
  validateInsideOpenspec(folderPath, openspecDir);

  const [proposalRaw, tasksRaw, designExists, capabilities, modifiedAt] = await Promise.all([
    readFileOrNull(join(folderPath, 'proposal.md')),
    readFileOrNull(join(folderPath, 'tasks.md')),
    pathExists(join(folderPath, 'design.md')),
    listSubdirectories(join(folderPath, 'specs')),
    mostRecentMtime(folderPath)
  ]);

  const summary: ArchivedChangeSummary = {
    changeId: parsedFolder.changeId,
    archiveFolder,
    archivedAt: parsedFolder.archivedAt,
    path: folderPath,
    hasProposal: proposalRaw !== null,
    hasTasks: tasksRaw !== null,
    hasDesign: designExists,
    capabilities: capabilities.sort(),
    modifiedAt
  };
  if (proposalRaw !== null) {
    summary.proposal = parseProposalMetadata(parsedFolder.changeId, proposalRaw);
  }
  if (tasksRaw !== null) {
    summary.taskProgress = parseTaskProgress(tasksRaw);
  }
  return summary;
}

export async function listArchivedChanges(rootDir: string): Promise<ArchivedChangeSummary[]> {
  const { archiveDir, openspecDir } = resolveRoot(rootDir);
  const folders = await listSubdirectories(archiveDir);
  const summaries = await Promise.all(folders.map((name) => buildArchivedSummary(archiveDir, openspecDir, name)));
  return summaries
    .filter((s): s is ArchivedChangeSummary => s !== null)
    .sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : 0));
}

export async function readArchivedChange(
  rootDir: string,
  archiveFolder: string
): Promise<ArchivedChangeSummary | null> {
  const { archiveDir, openspecDir } = resolveRoot(rootDir);
  // Validate the folder name shape before touching disk.
  try {
    parseArchivedFolder(archiveFolder);
  } catch {
    return null;
  }
  const folderPath = join(archiveDir, archiveFolder);
  validateInsideOpenspec(folderPath, openspecDir);
  if (!(await pathExists(folderPath))) return null;
  return buildArchivedSummary(archiveDir, openspecDir, archiveFolder);
}

export async function readArchivedChangeFile(
  rootDir: string,
  archiveFolder: string,
  kind: ChangeFileKind
): Promise<FileContent | null> {
  parseArchivedFolder(archiveFolder); // throws on bad shape
  const { archiveDir, openspecDir } = resolveRoot(rootDir);
  const filePath = join(archiveDir, archiveFolder, FILE_BASENAMES[kind]);
  validateInsideOpenspec(filePath, openspecDir);
  return readFileWithMtimeOrNull(filePath);
}

// ============================================================================
// current specs (capabilities)
// ============================================================================

export async function listCapabilities(rootDir: string): Promise<CapabilitySummary[]> {
  const { specsDir, openspecDir } = resolveRoot(rootDir);
  validateInsideOpenspec(specsDir, openspecDir);
  const folders = await listSubdirectories(specsDir);
  const summaries: CapabilitySummary[] = [];
  for (const name of folders) {
    try {
      validateCapabilityId(name);
    } catch {
      continue;
    }
    const folderPath = join(specsDir, name);
    const [hasSpec, hasDesign, modifiedAt] = await Promise.all([
      pathExists(join(folderPath, 'spec.md')),
      pathExists(join(folderPath, 'design.md')),
      mostRecentMtime(folderPath)
    ]);
    summaries.push({ capabilityId: name, hasSpec, hasDesign, modifiedAt });
  }
  return summaries.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}

export async function readCapabilityFile(
  rootDir: string,
  capabilityId: string,
  kind: CapabilityFileKind
): Promise<FileContent | null> {
  validateCapabilityId(capabilityId);
  const { specsDir, openspecDir } = resolveRoot(rootDir);
  const filePath = join(specsDir, capabilityId, CAPABILITY_FILE_BASENAMES[kind]);
  validateInsideOpenspec(filePath, openspecDir);
  return readFileWithMtimeOrNull(filePath);
}

export async function writeCapabilityFile(
  rootDir: string,
  capabilityId: string,
  kind: CapabilityFileKind,
  content: string
): Promise<void> {
  validateCapabilityId(capabilityId);
  const { specsDir, openspecDir } = resolveRoot(rootDir);
  const filePath = join(specsDir, capabilityId, CAPABILITY_FILE_BASENAMES[kind]);
  validateInsideOpenspec(filePath, openspecDir);
  await atomicWrite(filePath, content);
  console.log(
    `[openspec] writeCapabilityFile capability=${capabilityId} kind=${kind} bytes=${Buffer.byteLength(content, 'utf8')}`
  );
}

// ============================================================================
// project context
// ============================================================================

export async function readProjectContext(rootDir: string): Promise<ProjectContext> {
  const { openspecDir } = resolveRoot(rootDir);
  const [projectMd, agentsMd] = await Promise.all([
    readFileOrNull(join(openspecDir, 'project.md')),
    readFileOrNull(join(openspecDir, 'AGENTS.md'))
  ]);
  const out: ProjectContext = {};
  if (projectMd !== null) out.projectMd = projectMd;
  if (agentsMd !== null) out.agentsMd = agentsMd;
  return out;
}
