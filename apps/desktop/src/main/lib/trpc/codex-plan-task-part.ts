type TaskStatus = 'pending' | 'in_progress' | 'completed';

type PlanStepLike = {
  id?: string;
  title?: string;
  step?: string;
  description?: string;
  status?: string;
};

function extractPlanStepTitles(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const steps: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(?:\d+[\).\:-]|\-|\*)\s+(.+)$/);
    if (!match) continue;

    const title = match[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (title.length < 4) continue;

    steps.push(title.length > 120 ? `${title.slice(0, 117)}...` : title);
  }

  return steps.slice(0, 8);
}

function normalizeTaskStatus(status: unknown): TaskStatus {
  if (status === 'inProgress' || status === 'in_progress') return 'in_progress';
  if (status === 'completed') return 'completed';
  return 'pending';
}

function getPlanSteps(params: { text?: string; plan?: any }): PlanStepLike[] {
  const planLike = params.plan;
  if (planLike && typeof planLike === 'object' && Array.isArray(planLike.steps)) {
    return planLike.steps;
  }

  if (Array.isArray(planLike)) {
    return planLike;
  }

  return extractPlanStepTitles(params.text || '').map((title) => ({
    title,
    status: 'pending'
  }));
}

export function createTaskListPartFromPlan(params: { itemId: string; text?: string; plan?: any; startedAt?: number }) {
  const tasks = getPlanSteps(params).map((step, index) => {
    const title =
      typeof step?.step === 'string'
        ? step.step
        : typeof step?.title === 'string'
          ? step.title
          : `Task ${index + 1}`;

    return {
      id: typeof step?.id === 'string' && step.id.length > 0 ? step.id : `step-${index + 1}`,
      subject: title,
      ...(typeof step?.description === 'string' && step.description.length > 0 ? { description: step.description } : {}),
      status: normalizeTaskStatus(step?.status)
    };
  });

  const output = { tasks };

  return {
    type: 'tool-TaskList',
    toolCallId: params.itemId,
    toolName: 'TaskList',
    state: 'output-available',
    input: {},
    output,
    result: output,
    startedAt: params.startedAt ?? Date.now()
  };
}
