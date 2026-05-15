'use client';

import { useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { openSpecPendingCommandAtomFamily } from '../../openspec/atoms';
import type { OpenSpecStep } from '../../openspec/atoms';
import { AgentSendButton } from './agent-send-button';

interface OpenSpecSendButtonProps {
  subChatId: string;
  currentStep: OpenSpecStep;
  onSend: () => void;
  onStop: () => Promise<void>;
  isStreaming: boolean;
  hasContent: boolean;
  disabled: boolean;
}

export function OpenSpecSendButton({
  subChatId,
  currentStep,
  onSend,
  onStop,
  isStreaming,
  hasContent,
  disabled
}: OpenSpecSendButtonProps) {
  const pendingCommandAtom = useMemo(() => openSpecPendingCommandAtomFamily(subChatId), [subChatId]);
  const setPendingCommand = useSetAtom(pendingCommandAtom);

  const isTasksStep = currentStep === 'tasks';
  const primaryLabel = isTasksStep ? 'Apply' : 'Propose';

  const handlePrimary = () => {
    setPendingCommand(isTasksStep ? 'apply' : 'propose');
    onSend();
  };

  return (
    <AgentSendButton
      variant="square-action"
      actionLabel={primaryLabel}
      isStreaming={isStreaming}
      hasContent={hasContent}
      disabled={disabled}
      onClick={handlePrimary}
      onStop={onStop}
    />
  );
}
