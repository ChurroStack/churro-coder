import nunjucks from 'nunjucks';
import { detectWorktreeConfig } from '../git/worktree-config';
import { BUILTIN_PROMPTS } from '../../../prompts/index';

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true
});

export async function getPrompt(opts: {
  projectPath?: string;
  key: string;
  vars?: Record<string, unknown>;
}): Promise<string> {
  const builtin = BUILTIN_PROMPTS[opts.key];
  if (!builtin) throw new Error(`[PromptService] unknown prompt key: ${opts.key}`);

  const template = (await tryLoadUserPrompt(opts.projectPath, opts.key)) ?? builtin;
  try {
    return env.renderString(template, opts.vars ?? {});
  } catch (err) {
    if (template !== builtin) {
      console.warn(`[PromptService] user template for ${opts.key} failed, falling back to builtin`, err);
      return env.renderString(builtin, opts.vars ?? {});
    }
    throw err;
  }
}

async function tryLoadUserPrompt(projectPath: string | undefined, key: string): Promise<string | null> {
  if (!projectPath) return null;
  try {
    const detected = await detectWorktreeConfig(projectPath);
    const value = detected.config?.prompts?.[key];
    if (typeof value !== 'string') return null;
    if (value.trim() === '') return null;
    return value;
  } catch (err) {
    console.warn(`[PromptService] failed to read worktree.json for ${key}`, err);
    return null;
  }
}
