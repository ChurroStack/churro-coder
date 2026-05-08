/**
 * Shared types for the OpenSpec store.
 *
 * The store reads and writes the standard OpenSpec layout under <rootDir>/openspec/:
 *   openspec/
 *     project.md
 *     AGENTS.md
 *     specs/[capability]/{spec.md, design.md}
 *     changes/[change-id]/{proposal.md, tasks.md, design.md, specs/[capability]/spec.md}
 *     changes/archive/YYYY-MM-DD-[change-id]/...
 *
 * No `openspec` CLI or library is involved — parsing is structural markdown only.
 */

export type ChangeFileKind = 'proposal' | 'tasks' | 'design';
export type CapabilityFileKind = 'spec' | 'design';

export interface ProposalMetadata {
  /** Folder name of the change (kebab-case). */
  changeId: string;
  /** From frontmatter `title` if present, otherwise the first H1 (with the optional "Change: " prefix stripped). */
  title: string;
  /** First non-empty paragraph under `## Why`. */
  why?: string;
  /** Bullets under `## What Changes`. */
  whatChanges: string[];
  /** Parsed `## Impact` content. */
  impact?: { specs: string[]; code: string[] };
  /** Raw frontmatter (passthrough), so the UI can surface custom attributes. */
  attributes: Record<string, unknown>;
}

export interface ChangeSummary {
  changeId: string;
  /** Absolute path to the change folder. */
  path: string;
  hasProposal: boolean;
  hasTasks: boolean;
  hasDesign: boolean;
  /** Capability folders that exist under the change's `specs/` directory. */
  capabilities: string[];
  /** Parsed task progress from tasks.md (omitted when tasks.md is missing). */
  taskProgress?: { total: number; done: number };
  /** Populated when proposal.md exists and at least the title parses out. */
  proposal?: ProposalMetadata;
  /** ISO timestamp; most recent mtime found in the change folder. */
  modifiedAt: string;
}

export interface ArchivedChangeSummary extends ChangeSummary {
  /** YYYY-MM-DD prefix from the archive folder name. */
  archivedAt: string;
  /** The archive folder name (e.g. "2026-03-05-add-two-factor-auth"). */
  archiveFolder: string;
}

export interface CapabilitySummary {
  capabilityId: string;
  hasSpec: boolean;
  hasDesign: boolean;
  modifiedAt: string;
}

export interface Scenario {
  name: string;
  /** Raw markdown body of the scenario (the lines following the `#### Scenario:` header). */
  body: string;
}

export interface Requirement {
  name: string;
  /** Raw markdown body of the requirement (header line excluded, scenarios excluded). */
  body: string;
  scenarios: Scenario[];
}

export interface DeltaSpec {
  capabilityId: string;
  added: Requirement[];
  modified: Requirement[];
  removed: Requirement[];
  renamed: { from: string; to: string }[];
}

export interface FileContent {
  content: string;
  /** ISO timestamp of the file mtime when it was read. */
  modifiedAt: string;
}

export interface ProjectContext {
  projectMd?: string;
  agentsMd?: string;
}
