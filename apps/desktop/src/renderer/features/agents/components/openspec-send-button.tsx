'use client';

import { useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { MoreVertical } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../../components/ui/dropdown-menu';
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

  const handlePropose = () => {
    setPendingCommand('propose');
    onSend();
  };

  return (
    <div className="flex items-center gap-0.5">
      <AgentSendButton
        variant="square-action"
        actionLabel={primaryLabel}
        isStreaming={isStreaming}
        hasContent={hasContent}
        disabled={disabled}
        onClick={handlePrimary}
        onStop={onStop}
      />

      {/* Kebab: secondary Propose action, shown only on the Tasks step when idle */}
      {isTasksStep && !isStreaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
              aria-label="More send actions"
              type="button">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handlePropose}>Propose</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
