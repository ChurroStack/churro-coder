import nunjucks from 'nunjucks';
import { BUILTIN_PROMPTS } from './index';

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true
});

export function renderTemplate(template: string, vars: Record<string, unknown> = {}): string {
  return env.renderString(template, vars);
}

export function renderBuiltinPrompt(key: string, vars: Record<string, unknown> = {}): string {
  const template = BUILTIN_PROMPTS[key];
  if (!template) throw new Error(`[PromptService] unknown prompt key: ${key}`);
  return env.renderString(template, vars);
}
