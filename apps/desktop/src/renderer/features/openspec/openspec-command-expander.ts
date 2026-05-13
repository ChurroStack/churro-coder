import { renderBuiltinPrompt } from '../../../prompts/render';

type OpenSpecCommandName = 'propose' | 'apply' | 'verify' | 'archive';

export function expandOpenSpecCommand(message: string): string {
  const match = message.match(/^\/opsx:(propose|apply|verify|archive)\s*(.*)$/s);
  if (!match) return message;

  const [, command, args] = match as [string, OpenSpecCommandName, string];
  return renderBuiltinPrompt(`openspec/${command}`).replace(/\$ARGUMENTS/g, args.trim());
}
