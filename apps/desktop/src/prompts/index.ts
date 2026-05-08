const modules = import.meta.glob('./**/*.j2', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const BUILTIN_PROMPTS: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, content]) => [path.replace(/^\.\//, '').replace(/\.j2$/, ''), content])
);

export type PromptKey = string;
