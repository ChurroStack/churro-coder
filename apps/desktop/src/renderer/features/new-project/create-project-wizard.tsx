import { useAtom, useSetAtom } from 'jotai';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { newProjectDraftAtom, newProjectDialogOpenAtom, newProjectProgressAtom } from './atoms';
import { pendingNewWorkspacePromptAtom } from './pending-prompt-atoms';
import { useResetNewProjectDraft } from './use-reset-new-project-draft';
import { selectedProjectAtom } from '@/lib/atoms';
import { WizardSection } from '../agents/components/wizard-section';
import { ProviderSegmentedControl } from './provider-segmented-control';
import { AccountOrgPicker } from './account-org-picker';
import { AzureProjectPicker } from './azure-project-picker';
import { NameInput } from './name-input';
import { VisibilityCheckbox } from './visibility-checkbox';
import { OpenspecInitToggle } from './openspec-init-toggle';
import { CliInstallInstructions } from './cli-install-instructions';
import { AuthRequiredPanel } from './auth-required-panel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, AlertCircle, Loader2 } from 'lucide-react';
import type { NewProjectProgress, NewProjectStep } from './atoms';
import { useAtomValue } from 'jotai';
import { nanoid } from 'nanoid';

type SubmittedInput = {
  provider: 'github' | 'azure' | 'local';
  accountId: string;
  projectId?: string;
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  openspecInit: boolean;
  prompt: string;
  correlationId: string;
};

// Mirrors the server's NewProjectEvent. Kept local to avoid coupling the renderer
// to the main-process router type at import time.
type ProjectSubscriptionEvent =
  | { type: 'step'; step: NewProjectStep; status: 'pending' | 'done' | 'error'; message?: string }
  | { type: 'complete'; projectId: string; path: string }
  | { type: 'fatal'; step: NewProjectStep | 'rollback'; message: string };

type CreateProjectSubscriptionProps = {
  input: SubmittedInput;
  onEvent: (event: ProjectSubscriptionEvent) => void;
  onError: (message: string) => void;
};

/**
 * Thin wrapper around the createProject subscription. Mounted only when an
 * input is set so we never need to pass a placeholder to satisfy the schema.
 */
function CreateProjectSubscription({ input, onEvent, onError }: CreateProjectSubscriptionProps) {
  trpc.newProject.createProject.useSubscription(input, {
    onData: onEvent,
    onError: (err) => onError(err.message)
  });
  return null;
}

const STEP_LABELS: Record<keyof Omit<NewProjectProgress, 'lastError' | 'errors'>, string> = {
  validate: 'Validating name',
  'remote-create': 'Creating remote repository',
  clone: 'Cloning repository',
  scaffold: 'Writing project files',
  'openspec-init': 'Initializing OpenSpec',
  commit: 'Initial commit',
  push: 'Pushing to remote',
  'db-insert': 'Saving project'
};

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (status === 'pending') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  return <Circle className="h-4 w-4 text-muted-foreground/30" />;
}

function ProgressView() {
  const progress = useAtomValue(newProjectProgressAtom);
  const steps = Object.entries(STEP_LABELS) as [NewProjectStep, string][];

  return (
    <div className="space-y-2 py-4">
      {steps.map(([key, label]) => (
        <div key={key} className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <StepIcon status={progress[key]} />
            <span className={cn('text-sm', progress[key] === 'idle' ? 'text-muted-foreground/50' : 'text-foreground')}>
              {label}
            </span>
          </div>
          {progress[key] === 'error' && progress.errors[key] && (
            <p className="ml-7 text-xs text-destructive">{progress.errors[key]}</p>
          )}
        </div>
      ))}
      {progress.lastError && (
        <p className="mt-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">{progress.lastError}</p>
      )}
    </div>
  );
}

export function CreateProjectWizard() {
  const [draft, setDraft] = useAtom(newProjectDraftAtom);
  const progress = useAtomValue(newProjectProgressAtom);
  const setProgress = useSetAtom(newProjectProgressAtom);
  const setDialogOpen = useSetAtom(newProjectDialogOpenAtom);
  const resetDraft = useResetNewProjectDraft();
  const setSelectedProject = useSetAtom(selectedProjectAtom);
  const setPendingPrompt = useSetAtom(pendingNewWorkspacePromptAtom);

  const [completedResult, setCompletedResult] = useState<{
    projectId: string;
    path: string;
    prompt: string;
    name: string;
  } | null>(null);

  const [submittedInput, setSubmittedInput] = useState<SubmittedInput | null>(null);

  const isSubmitting = Object.entries(progress)
    .filter(([k]) => k !== 'lastError' && k !== 'errors')
    .some(([, v]) => v === 'pending');
  const isDone = completedResult !== null;
  const hasError = !!progress.lastError;
  const hasStepErrors = Object.values(progress.errors).some(Boolean);

  const trpcUtils = trpc.useUtils();

  const handleSubscriptionEvent = (event: ProjectSubscriptionEvent) => {
    if (event.type === 'step') {
      setProgress((p) => ({
        ...p,
        [event.step]: event.status,
        errors: {
          ...p.errors,
          ...(event.status === 'error' ? { [event.step]: event.message } : {})
        }
      }));
    } else if (event.type === 'complete') {
      trpcUtils.projects.list.invalidate();
      setCompletedResult({
        projectId: event.projectId,
        path: event.path,
        prompt: draft.prompt,
        name: draft.name
      });
    } else if (event.type === 'fatal') {
      setProgress((p) => ({ ...p, lastError: event.message }));
    }
  };

  const handleSubscriptionError = (message: string) => {
    setProgress((p) => ({ ...p, lastError: message }));
  };

  const handleGoToProject = () => {
    if (!completedResult) return;
    // Pre-fill the New workspace textarea so the user keeps the prompt they typed.
    setPendingPrompt(completedResult.prompt);
    setSelectedProject({ id: completedResult.projectId, name: completedResult.name, path: completedResult.path });
    resetDraft();
    setCompletedResult(null);
    setSubmittedInput(null);
    setDialogOpen(false);
  };

  const handleStartOver = () => {
    resetDraft();
    setCompletedResult(null);
    setSubmittedInput(null);
    setProgress({
      validate: 'idle',
      'remote-create': 'idle',
      clone: 'idle',
      scaffold: 'idle',
      'openspec-init': 'idle',
      commit: 'idle',
      push: 'idle',
      'db-insert': 'idle',
      errors: {}
    });
  };

  const handleSubmit = () => {
    if (isSubmitting) return;
    const newCorrelationId = nanoid();
    setCompletedResult(null);
    setProgress({
      validate: 'idle',
      'remote-create': 'idle',
      clone: 'idle',
      scaffold: 'idle',
      'openspec-init': 'idle',
      commit: 'idle',
      push: 'idle',
      'db-insert': 'idle',
      errors: {}
    });
    setSubmittedInput({ ...draft, correlationId: newCorrelationId });
  };

  const promptLength = draft.prompt.length;
  const promptError = draft.prompt && promptLength < 10 ? 'At least 10 characters required' : undefined;
  const canSubmit =
    !isSubmitting &&
    !isDone &&
    draft.name &&
    draft.prompt.length >= 10 &&
    (draft.provider === 'local' || draft.accountId);

  if (submittedInput || isSubmitting || isDone || hasError) {
    return (
      <div className="flex h-full flex-col">
        {submittedInput && (
          <CreateProjectSubscription
            input={submittedInput}
            onEvent={handleSubscriptionEvent}
            onError={handleSubscriptionError}
          />
        )}
        <ProgressView />
        {isDone && (
          <Button onClick={handleGoToProject} className="mt-4 w-full">
            Go to project
          </Button>
        )}
        {(hasError || (isDone && hasStepErrors)) && (
          <Button variant="outline" onClick={handleStartOver} className="mt-4">
            Start over
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Provider */}
      <WizardSection
        step={1}
        label="Provider"
        description="Where to host the new repository. GitHub and Azure DevOps require their CLIs to be installed and authenticated.">
        <ProviderSegmentedControl />
        <CliInstallInstructions provider={draft.provider} />
        {draft.provider !== 'local' && <AuthRequiredPanel provider={draft.provider} />}
      </WizardSection>

      {/* Account / Org */}
      {draft.provider !== 'local' && (
        <WizardSection
          step={2}
          label={draft.provider === 'azure' ? 'Organization' : 'Account'}
          description={
            draft.provider === 'azure'
              ? 'Your Azure DevOps organization URL (e.g. https://dev.azure.com/my-org) and the target project.'
              : 'The GitHub account or organization that will own this repository.'
          }>
          <AccountOrgPicker />
          {draft.provider === 'azure' && <AzureProjectPicker />}
        </WizardSection>
      )}

      {/* Name */}
      <WizardSection
        step={draft.provider === 'local' ? 2 : 3}
        label="Repository name"
        description="Lowercase letters, numbers, and hyphens only. Examples: my-saas-app, data-pipeline-v2, acme-dashboard.">
        <NameInput />
        {draft.provider === 'github' && <VisibilityCheckbox />}
      </WizardSection>

      {/* Description — hidden for local (no remote to display it on) */}
      {draft.provider !== 'local' && (
        <WizardSection
          step={4}
          label="Description (optional)"
          description="A short summary shown in GitHub / Azure. Examples: 'Real-time analytics dashboard for e-commerce teams', 'CLI that converts Figma exports to Tailwind components'.">
          <div className="relative">
            <Input
              placeholder="A short description of your project"
              value={draft.description}
              maxLength={350}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
            {draft.description.length > 300 && (
              <span className="absolute right-2 top-2 text-xs text-muted-foreground">
                {350 - draft.description.length}
              </span>
            )}
          </div>
        </WizardSection>
      )}

      {/* OpenSpec */}
      <WizardSection
        step={draft.provider === 'local' ? 3 : 5}
        label="OpenSpec"
        description="Adds proposal + design artifacts before coding, spec-driven task tracking inside the repo, and consistent agent instructions across Claude, Codex, and Cursor.">
        <OpenspecInitToggle />
      </WizardSection>

      {/* Initial prompt */}
      <WizardSection
        step={draft.provider === 'local' ? 4 : 6}
        label="What to build *"
        description="Be specific: tech stack, features, goals. Examples: 'REST API for a todo app with users and lists — Express + TypeScript + Postgres', 'Next.js 14 app with Drizzle, Tailwind, shadcn/ui and Lucia auth'.">
        <div className="space-y-1">
          <Textarea
            placeholder="Describe what you want to build. Be specific about the tech stack, features, and goals."
            value={draft.prompt}
            maxLength={4000}
            rows={5}
            onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
            className={cn(promptError ? 'border-destructive' : '')}
          />
          <div className="flex items-center justify-between">
            {promptError ? <p className="text-xs text-destructive">{promptError}</p> : <span />}
            <span className="text-xs text-muted-foreground">{promptLength}/4000</span>
          </div>
        </div>
      </WizardSection>

      <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
        Create project
      </Button>
    </div>
  );
}
