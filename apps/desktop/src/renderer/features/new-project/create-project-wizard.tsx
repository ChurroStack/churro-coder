import { useAtom, useSetAtom } from 'jotai';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { newProjectDraftAtom, newProjectDialogOpenAtom, newProjectProgressAtom } from './atoms';
import { useResetNewProjectDraft } from './use-reset-new-project-draft';
import { selectedProjectAtom, selectedAgentChatIdAtom } from '@/lib/atoms';
import { pendingInitialPromptAtom } from './pending-prompt-atoms';
import { WizardSection } from '../agents/components/wizard-section';
import { ProviderSegmentedControl } from './provider-segmented-control';
import { AccountOrgPicker } from './account-org-picker';
import { AzureProjectPicker } from './azure-project-picker';
import { NameInput } from './name-input';
import { VisibilityCheckbox } from './visibility-checkbox';
import { OpenspecInitToggle } from './openspec-init-toggle';
import { CliInstallInstructions } from './cli-install-instructions';
import { AuthRequiredPanel } from './auth-required-panel';
import { HelpPanel, type FocusedField } from './help-panel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, AlertCircle, Loader2 } from 'lucide-react';
import type { NewProjectProgress } from './atoms';
import { useAtomValue } from 'jotai';
import { nanoid } from 'nanoid';

const STEP_LABELS: Record<keyof Omit<NewProjectProgress, 'lastError'>, string> = {
  validate: 'Validating name',
  'remote-create': 'Creating remote repository',
  clone: 'Cloning repository',
  scaffold: 'Writing project files',
  commit: 'Initial commit',
  push: 'Pushing to remote',
  'db-insert': 'Saving project',
  'chat-create': 'Creating workspace',
  'worktree-create': 'Setting up worktree',
  'openspec-init': 'Initializing OpenSpec'
};

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (status === 'pending') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  return <Circle className="h-4 w-4 text-muted-foreground/30" />;
}

function ProgressView() {
  const progress = useAtomValue(newProjectProgressAtom);
  const steps = Object.entries(STEP_LABELS) as [keyof typeof STEP_LABELS, string][];

  return (
    <div className="space-y-2 py-4">
      {steps.map(([key, label]) => (
        <div key={key} className="flex items-center gap-3">
          <StepIcon status={progress[key]} />
          <span className={cn('text-sm', progress[key] === 'idle' ? 'text-muted-foreground/50' : 'text-foreground')}>
            {label}
          </span>
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
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom);
  const [focusedField, setFocusedField] = useState<FocusedField>(null);

  const isSubmitting = Object.values(progress).some((v) => v === 'pending');
  const isDone = progress['chat-create'] === 'done';

  const setPendingPrompt = useSetAtom(pendingInitialPromptAtom(draft.correlationId));

  const mutation = trpc.newProject.createProject.useMutation({
    onSuccess: (result) => {
      setProgress((p) => ({ ...p, 'chat-create': 'done', 'worktree-create': 'done' }));
      setPendingPrompt(draft.prompt);
      setSelectedProject({ id: result.projectId, name: draft.name, path: '' });
      setSelectedChatId(result.chatId);
      resetDraft();
      setDialogOpen(false);
    },
    onError: (err) => {
      setProgress((p) => ({ ...p, lastError: err.message }));
    }
  });

  const handleSubmit = () => {
    if (isSubmitting) return;
    const newCorrelationId = nanoid();
    setDraft((d) => ({ ...d, correlationId: newCorrelationId }));
    setProgress({
      validate: 'pending',
      'remote-create': 'idle',
      clone: 'idle',
      scaffold: 'idle',
      commit: 'idle',
      push: 'idle',
      'db-insert': 'idle',
      'chat-create': 'idle',
      'worktree-create': 'idle',
      'openspec-init': 'idle'
    });
    mutation.mutate({ ...draft, correlationId: newCorrelationId });
  };

  const promptLength = draft.prompt.length;
  const promptError = draft.prompt && promptLength < 10 ? 'At least 10 characters required' : undefined;
  const canSubmit =
    !isSubmitting &&
    !isDone &&
    draft.name &&
    draft.prompt.length >= 10 &&
    (draft.provider === 'local' || draft.accountId);

  if (isSubmitting || isDone) {
    return (
      <div className="flex h-full flex-col">
        <ProgressView />
        {progress.lastError && (
          <Button variant="outline" onClick={resetDraft} className="mt-4">
            Start over
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_280px] gap-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div className="space-y-6">
        {/* Provider */}
        <WizardSection step={1} label="Provider">
          <ProviderSegmentedControl />
          <CliInstallInstructions provider={draft.provider} />
          {draft.provider !== 'local' && <AuthRequiredPanel provider={draft.provider} />}
        </WizardSection>

        {/* Account / Org */}
        {draft.provider !== 'local' && (
          <WizardSection step={2} label={draft.provider === 'azure' ? 'Organization' : 'Account'}>
            <AccountOrgPicker />
            {draft.provider === 'azure' && <AzureProjectPicker />}
          </WizardSection>
        )}

        {/* Name */}
        <WizardSection step={draft.provider === 'local' ? 2 : 3} label="Repository name">
          <NameInput onFocus={() => setFocusedField('name')} onBlur={() => setFocusedField(null)} />
          {draft.provider === 'github' && <VisibilityCheckbox />}
        </WizardSection>

        {/* Description */}
        <WizardSection step={draft.provider === 'local' ? 3 : 4} label="Description (optional)">
          <div className="relative">
            <Input
              placeholder="A short description of your project"
              value={draft.description}
              maxLength={350}
              onFocus={() => setFocusedField('description')}
              onBlur={() => setFocusedField(null)}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
            {draft.description.length > 300 && (
              <span className="absolute right-2 top-2 text-xs text-muted-foreground">
                {350 - draft.description.length}
              </span>
            )}
          </div>
        </WizardSection>

        {/* OpenSpec */}
        <WizardSection step={draft.provider === 'local' ? 4 : 5} label="OpenSpec">
          <OpenspecInitToggle />
        </WizardSection>

        {/* Initial prompt */}
        <WizardSection step={draft.provider === 'local' ? 5 : 6} label="What to build *">
          <div className="space-y-1">
            <Textarea
              placeholder="Describe what you want to build. Be specific about the tech stack, features, and goals."
              value={draft.prompt}
              maxLength={4000}
              rows={5}
              onFocus={() => setFocusedField('prompt')}
              onBlur={() => setFocusedField(null)}
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

      {/* Help panel */}
      <div className="sticky top-0 rounded-md border border-border bg-muted/30 min-h-[200px]">
        <HelpPanel focusedField={focusedField} />
      </div>
    </div>
  );
}
