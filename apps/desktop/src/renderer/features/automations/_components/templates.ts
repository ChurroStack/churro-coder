import type { AutomationTemplate } from './types';
import { BUILTIN_PROMPTS } from '../../../../prompts/index';

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'enrich-github-issue',
    name: 'Enrich Github Issue',
    platform: 'github',
    triggerType: 'issue_opened',
    description: 'Automatically analyze and enrich new GitHub issues with relevant context.',
    instructions: BUILTIN_PROMPTS['automation/enrich-github-issue']
  },
  {
    id: 'pr-reviews',
    name: 'PR Reviews',
    platform: 'github',
    triggerType: 'pr_opened',
    description: 'Automatically review pull requests for code quality and best practices.',
    instructions: BUILTIN_PROMPTS['automation/pr-reviews']
  },
  {
    id: 'auto-pr-description',
    name: 'Auto PR Description',
    platform: 'github',
    triggerType: 'pr_opened',
    description: 'Automatically generate PR descriptions based on the changes made.',
    instructions: BUILTIN_PROMPTS['automation/auto-pr-description']
  },
  {
    id: 'auto-fix-ci',
    name: 'Auto Fix CI',
    platform: 'github',
    triggerType: 'workflow_failed',
    description: 'Automatically diagnose and fix CI failures.',
    instructions: BUILTIN_PROMPTS['automation/auto-fix-ci']
  },
  {
    id: 'linear-issue-implementation',
    name: 'Implement Linear Issue',
    platform: 'linear',
    triggerType: 'linear_issue_created',
    description: 'Automatically start implementing new Linear issues.',
    instructions: BUILTIN_PROMPTS['automation/linear-issue-implementation']
  }
];
