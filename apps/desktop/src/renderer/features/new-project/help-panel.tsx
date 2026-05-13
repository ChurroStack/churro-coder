import { useState } from 'react';

type FocusedField = 'name' | 'description' | 'openspec' | 'prompt' | null;

const EXAMPLES: Record<NonNullable<FocusedField>, { heading: string; items: string[] }> = {
  name: {
    heading: 'Good names',
    items: ['my-saas-app', 'data-pipeline-v2', 'acme-dashboard']
  },
  description: {
    heading: 'Good descriptions',
    items: [
      'A real-time analytics dashboard for e-commerce teams',
      'CLI tool that converts Figma exports to Tailwind components',
      'REST API gateway with rate limiting and auth middleware'
    ]
  },
  openspec: {
    heading: 'OpenSpec gives you',
    items: [
      'Proposal + design artifacts before coding',
      'Spec-driven task tracking inside the repo',
      'Consistent agent instructions across Claude, Codex, and Cursor'
    ]
  },
  prompt: {
    heading: 'Good initial prompts',
    items: [
      'Build a REST API for a todo app with users, lists, and items. Use Express + TypeScript + Postgres.',
      'Create a CLI that watches a directory and auto-formats changed files using Prettier.',
      'Set up a Next.js 14 app with Drizzle, Tailwind, and shadcn/ui. Add a simple auth flow using Lucia.'
    ]
  }
};

interface HelpPanelProps {
  focusedField: FocusedField;
}

export function HelpPanel({ focusedField }: HelpPanelProps) {
  if (!focusedField) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Focus a field to see examples
      </div>
    );
  }

  const { heading, items } = EXAMPLES[focusedField];

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</p>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type { FocusedField };
