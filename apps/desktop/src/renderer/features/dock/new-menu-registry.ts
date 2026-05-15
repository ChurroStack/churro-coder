import type { Harness } from '../agents/lib/harness-icons';

export type NewMenuEntryKind = 'chat' | 'chat-claude-cli' | 'chat-codex-cli' | 'terminal' | 'openspec-change';

export interface NewMenuEntry {
  kind: NewMenuEntryKind;
  label: string;
  /** harness to set when creating a subChat entry; undefined for non-chat entries */
  harness?: Harness;
  defaultPinned: boolean;
}

export const NEW_MENU_REGISTRY: NewMenuEntry[] = [
  {
    kind: 'chat',
    label: 'New Chat',
    harness: 'builtin',
    defaultPinned: true
  },
  {
    kind: 'chat-claude-cli',
    label: 'New Claude CLI Chat',
    harness: 'claude-cli',
    defaultPinned: false
  },
  {
    kind: 'chat-codex-cli',
    label: 'New Codex CLI Chat',
    harness: 'codex-cli',
    defaultPinned: false
  },
  {
    kind: 'terminal',
    label: 'New Terminal',
    defaultPinned: true
  },
  {
    kind: 'openspec-change',
    label: 'New OpenSpec Change',
    defaultPinned: false
  }
];

export const DEFAULT_PINNED: NewMenuEntryKind[] = NEW_MENU_REGISTRY.filter((e) => e.defaultPinned).map((e) => e.kind);
