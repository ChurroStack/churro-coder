import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export type OpenspecTool = 'claude' | 'codex';

interface OpenSpecToolsToggleProps {
  value: OpenspecTool[];
  onChange: (tools: OpenspecTool[]) => void;
  availableTools?: OpenspecTool[];
}

const TOOLS: { id: OpenspecTool; label: string; note?: string }[] = [
  { id: 'claude', label: 'Claude' },
  {
    id: 'codex',
    label: 'Codex',
    note: 'Also writes prompts to your global $CODEX_HOME/prompts/ directory.'
  }
];

export function OpenSpecToolsToggle({ value, onChange, availableTools }: OpenSpecToolsToggleProps) {
  const visibleTools = availableTools ? TOOLS.filter((t) => availableTools.includes(t.id)) : TOOLS;

  function toggle(tool: OpenspecTool, checked: boolean) {
    if (checked) {
      onChange([...value, tool]);
    } else {
      onChange(value.filter((t) => t !== tool));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Install CLI skills for</p>
      <div className="flex flex-col gap-1.5">
        {visibleTools.map(({ id, label, note }) => (
          <div key={id} className="flex items-center gap-2">
            <Checkbox
              id={`openspec-tool-${id}`}
              checked={value.includes(id)}
              onCheckedChange={(checked) => toggle(id, !!checked)}
            />
            <div className="flex flex-col">
              <Label htmlFor={`openspec-tool-${id}`} className="text-sm leading-none cursor-pointer">
                {label}
              </Label>
              {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
