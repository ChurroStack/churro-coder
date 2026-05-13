import { describe, expect, test } from 'vitest';
import { renderBuiltinPrompt } from '../../../../prompts/render';
import { BUILTIN_COMMAND_PATH_PREFIX, OPENSPEC_BUILTIN_COMMANDS } from '../../openspec/builtin-commands';

describe('OpenSpec built-in slash commands', () => {
  test('registers the four supported opsx commands', () => {
    expect(OPENSPEC_BUILTIN_COMMANDS.map((command) => command.name)).toEqual([
      'opsx:propose',
      'opsx:apply',
      'opsx:verify',
      'opsx:archive'
    ]);
    expect(OPENSPEC_BUILTIN_COMMANDS).toHaveLength(4);
  });

  test('uses builtin source, builtin paths, and vendored prompt content', () => {
    for (const command of OPENSPEC_BUILTIN_COMMANDS) {
      const promptKey = `openspec/${command.name.replace('opsx:', '')}`;

      expect(command.source).toBe('builtin');
      expect(command.path).toBe(`${BUILTIN_COMMAND_PATH_PREFIX}${command.name}`);
      expect(command.content).toBe(renderBuiltinPrompt(promptKey));
      expect(command.content.trim().length).toBeGreaterThan(0);
      expect(command.content).not.toContain('{#');
    }
  });

  test('exposes apply section/task argument hint only on apply', () => {
    expect(OPENSPEC_BUILTIN_COMMANDS.find((command) => command.name === 'opsx:apply')?.argumentHint).toBe(
      '[section-or-task]'
    );
    for (const command of OPENSPEC_BUILTIN_COMMANDS.filter((command) => command.name !== 'opsx:apply')) {
      expect(command.argumentHint).toBeUndefined();
    }
  });

  test('router lists local and plugin commands before built-ins for override precedence', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./commands.ts', import.meta.url), 'utf8')
    );

    expect(source).toContain('return [...projectCommands, ...userCommands, ...pluginCommands, ...builtinCommands]');
  });
});
