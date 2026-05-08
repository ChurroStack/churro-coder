import type { BuiltinCommandAction, SlashCommandOption } from './types';
import { BUILTIN_PROMPTS } from '../../../../prompts/index';

/**
 * Prompt texts for prompt-based slash commands
 */
export const COMMAND_PROMPTS: Partial<Record<BuiltinCommandAction['type'], string>> = {
  review: BUILTIN_PROMPTS['slash/review'],
  'release-notes': BUILTIN_PROMPTS['slash/release-notes'],
  'security-review': BUILTIN_PROMPTS['slash/security-review'],
  commit: BUILTIN_PROMPTS['slash/commit'],
  init: BUILTIN_PROMPTS['slash/init'],
  simplify: BUILTIN_PROMPTS['slash/simplify'],
  'scripts-fill': BUILTIN_PROMPTS['slash/scripts-fill'],
  'worktree-setup': BUILTIN_PROMPTS['slash/worktree-setup']
};

/**
 * Check if a command is a prompt-based command
 */
export function isPromptCommand(
  type: BuiltinCommandAction['type']
): type is
  | 'review'
  | 'release-notes'
  | 'security-review'
  | 'commit'
  | 'worktree-setup'
  | 'scripts-fill'
  | 'init'
  | 'simplify' {
  return type in COMMAND_PROMPTS;
}

/**
 * Built-in slash commands that are handled client-side
 */
export const BUILTIN_SLASH_COMMANDS: SlashCommandOption[] = [
  {
    id: 'builtin:clear',
    name: 'clear',
    command: '/clear',
    description: 'Start a new conversation (creates new sub-chat)',
    category: 'builtin'
  },
  {
    id: 'builtin:plan',
    name: 'plan',
    command: '/plan',
    description: 'Switch to Plan mode (creates plan before making changes)',
    category: 'builtin'
  },
  {
    id: 'builtin:execute',
    name: 'execute',
    command: '/execute',
    description: 'Switch to Execute mode (applies changes directly)',
    category: 'builtin'
  },
  {
    id: 'builtin:explore',
    name: 'explore',
    command: '/explore',
    description: 'Switch to Explore mode (read-only investigation)',
    category: 'builtin'
  },
  {
    id: 'builtin:compact',
    name: 'compact',
    command: '/compact',
    description: 'Compact conversation context to reduce token usage',
    category: 'builtin'
  },
  {
    id: 'builtin:help',
    name: 'help',
    command: '/help',
    description: 'List all available slash commands',
    category: 'builtin'
  },
  // Prompt-based commands
  {
    id: 'builtin:review',
    name: 'review',
    command: '/review',
    description: 'Ask agent to review your code',
    category: 'builtin'
  },
  {
    id: 'builtin:release-notes',
    name: 'release-notes',
    command: '/release-notes',
    description: 'Ask agent to generate release notes',
    category: 'builtin'
  },
  {
    id: 'builtin:security-review',
    name: 'security-review',
    command: '/security-review',
    description: 'Ask agent to perform a security audit',
    category: 'builtin'
  },
  {
    id: 'builtin:commit',
    name: 'commit',
    command: '/commit',
    description: 'Commit staged changes carefully without touching anything else',
    category: 'builtin'
  },
  {
    id: 'builtin:worktree-setup',
    name: 'worktree-setup',
    command: '/worktree-setup',
    description: 'Generate worktree setup config with AI',
    category: 'builtin'
  },
  {
    id: 'builtin:scripts-fill',
    name: 'scripts-fill',
    command: '/scripts-fill',
    description: 'Generate runnable scripts for the Scripts widget',
    category: 'builtin'
  },
  {
    id: 'builtin:init',
    name: 'init',
    command: '/init',
    description: 'Initialize a CLAUDE.md project guide',
    category: 'builtin'
  },
  {
    id: 'builtin:simplify',
    name: 'simplify',
    command: '/simplify',
    description: 'Review code for reuse, quality, and efficiency',
    category: 'builtin'
  }
];

/**
 * Filter builtin commands by search text
 */
export function filterBuiltinCommands(searchText: string): SlashCommandOption[] {
  if (!searchText) return BUILTIN_SLASH_COMMANDS;

  const query = searchText.toLowerCase();
  return BUILTIN_SLASH_COMMANDS.filter(
    (cmd) => cmd.name.toLowerCase().includes(query) || cmd.description.toLowerCase().includes(query)
  );
}
