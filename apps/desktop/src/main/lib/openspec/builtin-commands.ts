import { renderBuiltinPrompt } from '../../../prompts/render';

export interface OpenSpecBuiltinCommand {
  name: string;
  description: string;
  argumentHint?: string;
  source: 'builtin';
  pluginName?: string;
  path: string;
  content: string;
}

export const BUILTIN_COMMAND_PATH_PREFIX = 'builtin://';

export const OPENSPEC_BUILTIN_COMMANDS: OpenSpecBuiltinCommand[] = [
  {
    name: 'opsx:propose',
    description: 'Create or refine the current OpenSpec change and its planning artifacts',
    source: 'builtin',
    path: `${BUILTIN_COMMAND_PATH_PREFIX}opsx:propose`,
    content: renderBuiltinPrompt('openspec/propose')
  },
  {
    name: 'opsx:apply',
    description: 'Implement the current OpenSpec change tasks',
    argumentHint: '[section-or-task]',
    source: 'builtin',
    path: `${BUILTIN_COMMAND_PATH_PREFIX}opsx:apply`,
    content: renderBuiltinPrompt('openspec/apply')
  },
  {
    name: 'opsx:verify',
    description: 'Review the current OpenSpec change against artifacts and code',
    source: 'builtin',
    path: `${BUILTIN_COMMAND_PATH_PREFIX}opsx:verify`,
    content: renderBuiltinPrompt('openspec/verify')
  },
  {
    name: 'opsx:archive',
    description: 'Archive the current OpenSpec change when work is complete',
    source: 'builtin',
    path: `${BUILTIN_COMMAND_PATH_PREFIX}opsx:archive`,
    content: renderBuiltinPrompt('openspec/archive')
  }
];
