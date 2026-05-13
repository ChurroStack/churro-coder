import { readFile } from 'node:fs/promises';

/**
 * Render a template file by substituting all `{{varName}}` placeholders with
 * the corresponding values from `vars`. Unrecognised placeholders are left as-is.
 */
export async function renderTemplate(templatePath: string, vars: Record<string, string>): Promise<string> {
  const raw = await readFile(templatePath, 'utf8');
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}
