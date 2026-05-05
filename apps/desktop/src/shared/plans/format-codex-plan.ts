/**
 * Shared helpers for formatting Codex PlanWrite tool output as markdown.
 * Used by both the renderer (active-chat.tsx) and main process (plan-store).
 */

export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMcpContentJson(value: unknown): any | null {
  if (!isRecord(value) || !Array.isArray(value.content)) return null;
  const textPart = value.content.find((item: unknown) => isRecord(item) && typeof item.text === 'string');
  if (!textPart) return null;
  try {
    return JSON.parse((textPart as any).text);
  } catch {
    return null;
  }
}

export function formatStructuredPlanAsMarkdown(plan: any): string {
  if (!isRecord(plan)) return '';

  const lines: string[] = [];
  const steps = Array.isArray(plan.steps) ? plan.steps : [];

  if (typeof plan.title === 'string' && plan.title.trim()) {
    lines.push(`# ${plan.title.trim()}`);
  }

  if (typeof plan.summary === 'string' && plan.summary.trim()) {
    lines.push('## Context');
    lines.push(plan.summary.trim());
  }

  if (steps.length > 0) {
    lines.push('## Implementation Steps');
    lines.push(
      steps
        .map((step: any, index: number) => {
          const title = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : `Step ${index + 1}`;
          const stepLines = [`${index + 1}. ${title}`];
          if (typeof step?.description === 'string' && step.description.trim()) {
            stepLines.push(`   ${step.description.trim()}`);
          }
          if (Array.isArray(step?.files) && step.files.length > 0) {
            stepLines.push(`   Files: ${step.files.map((file: unknown) => `\`${String(file)}\``).join(', ')}`);
          }
          return stepLines.join('\n');
        })
        .join('\n\n')
    );
  }

  return lines.join('\n\n').trim();
}

export function getPlanFromPlanWritePart(part: any): any | null {
  const candidates = [
    part?.input?.plan,
    part?.input?.args?.plan,
    part?.input?.arguments?.plan,
    part?.args?.plan,
    part?.output?.plan,
    part?.result?.plan,
    part?.output?.structuredContent?.plan,
    part?.result?.structuredContent?.plan,
    parseMcpContentJson(part?.output)?.plan,
    parseMcpContentJson(part?.result)?.plan
  ];

  return candidates.find((plan) => isRecord(plan)) || null;
}
