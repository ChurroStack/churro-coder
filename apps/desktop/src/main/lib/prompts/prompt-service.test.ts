import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prompts/index before importing prompt-service (import.meta.glob won't work in Node tests)
vi.mock('../../../prompts/index', () => ({
  BUILTIN_PROMPTS: {
    'slash/review': 'Please review the code in the current context.',
    'workflow/merge-base':
      'Merge latest from {{ baseBranch }} into the current branch and resolve any conflicts. Run `git fetch origin {{ baseBranch }}` first, then `git merge origin/{{ baseBranch }}`. Resolve any conflicts and commit the merge.',
    'workflow/implement-plan':
      'Implement plan. First, call the app-owned `read_plan` MCP tool to retrieve the approved plan. In Codex sessions this tool is exposed as `{{ mcpToolName | default("mcp__churro-coder__read_plan") }}`. Use EXACTLY this argument object when a sub-chat id is required: { "subChatId": "{{ subChatId }}" }. Then implement it. Track progress through each plan step using your built-in task-management tool: open a task list at the start and update each item\'s status (pending → in_progress → completed) as you work.',
    'mode/codex-approved-plan-hint':
      '[CONTEXT] Sub-chat id: {{ subChatId }}. An approved plan governs this sub-chat. For an implement-plan turn, call `{{ mcpToolName }}` before editing and use Codex-native task tools to track progress. Call `{{ mcpToolName }}` with EXACTLY this argument object: { "subChatId": "{{ subChatId }}" }. The subChatId argument is required — do not call the tool without it.',
    'workflow/commit-to-pr':
      '{% if uncommittedCount == 0 %}All changes are already committed. The branch {{ branch }} is up to date.{% else %}There are {{ uncommittedCount }} uncommitted changes on branch {{ branch }}.\nThe PR already exists and targets origin/{{ baseBranch }}.\n\nPlease commit and push these changes to update the PR:\n\n1. Run git diff to review uncommitted changes\n2. Commit them with a clear, concise commit message\n3. Push to origin to update the PR\n4. If any of these steps fail, ask the user for help.{% endif %}'
  }
}));

vi.mock('../git/worktree-config', () => ({
  detectWorktreeConfig: vi.fn()
}));

import { getPrompt } from './prompt-service';
import { detectWorktreeConfig } from '../git/worktree-config';

const mockDetect = detectWorktreeConfig as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockDetect.mockResolvedValue({ config: null, path: null, source: null });
});

describe('getPrompt – variable substitution', () => {
  it('renders merge-base with baseBranch', async () => {
    const result = await getPrompt({ key: 'workflow/merge-base', vars: { baseBranch: 'main' } });
    expect(result).toContain('Merge latest from main into the current branch');
    expect(result).toContain('git fetch origin main');
    expect(result).toContain('git merge origin/main');
    expect(result).not.toContain('{{');
  });

  it('renders implement-plan with subChatId', async () => {
    const result = await getPrompt({
      key: 'workflow/implement-plan',
      vars: { subChatId: 'abc-123', mcpToolName: 'mcp__churro-coder-dev__read_plan' }
    });
    expect(result).toContain('"subChatId": "abc-123"');
    expect(result).toContain('mcp__churro-coder-dev__read_plan');
    expect(result).not.toContain('{{');
  });

  it('renders codex-approved-plan-hint with subChatId', async () => {
    const result = await getPrompt({
      key: 'mode/codex-approved-plan-hint',
      vars: { subChatId: 'xyz-789', mcpToolName: 'mcp__churro-coder__read_plan' }
    });
    expect(result).toContain('Sub-chat id: xyz-789');
    expect(result).toContain('"subChatId": "xyz-789"');
    expect(result).toContain('mcp__churro-coder__read_plan');
    expect(result).not.toContain('{{');
  });

  it('renders commit-to-pr with uncommittedCount == 0', async () => {
    const result = await getPrompt({
      key: 'workflow/commit-to-pr',
      vars: { uncommittedCount: 0, branch: 'feat/foo', baseBranch: 'main' }
    });
    expect(result).toBe('All changes are already committed. The branch feat/foo is up to date.');
  });

  it('renders commit-to-pr with uncommittedCount > 0', async () => {
    const result = await getPrompt({
      key: 'workflow/commit-to-pr',
      vars: { uncommittedCount: 3, branch: 'feat/foo', baseBranch: 'main' }
    });
    expect(result).toContain('3 uncommitted changes');
    expect(result).toContain('feat/foo');
    expect(result).toContain('origin/main');
  });
});

describe('getPrompt – static prompts', () => {
  it('returns non-empty string for slash/review', async () => {
    const result = await getPrompt({ key: 'slash/review' });
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain('{{');
  });
});

describe('getPrompt – service behavior', () => {
  it('throws on unknown key', async () => {
    await expect(getPrompt({ key: 'nonexistent/key' })).rejects.toThrow('[PromptService] unknown prompt key');
  });

  it('throws on missing required variable (throwOnUndefined)', async () => {
    // merge-base requires baseBranch — omitting vars should throw
    await expect(getPrompt({ key: 'workflow/merge-base' })).rejects.toThrow();
  });

  it('uses user override when projectPath and key match', async () => {
    mockDetect.mockResolvedValue({
      config: { prompts: { 'slash/review': 'CUSTOM override {{ tag }}' } },
      path: '/p/.cscode/worktree.json',
      source: 'cscode'
    });
    const result = await getPrompt({ projectPath: '/p', key: 'slash/review', vars: { tag: 'v1' } });
    expect(result).toBe('CUSTOM override v1');
  });

  it('falls back to builtin when user override is empty string', async () => {
    mockDetect.mockResolvedValue({
      config: { prompts: { 'slash/review': '' } },
      path: '/p/.cscode/worktree.json',
      source: 'cscode'
    });
    const result = await getPrompt({ projectPath: '/p', key: 'slash/review' });
    expect(result).toBe('Please review the code in the current context.');
  });

  it('falls back to builtin when user override is whitespace-only', async () => {
    mockDetect.mockResolvedValue({
      config: { prompts: { 'slash/review': '   \n  ' } },
      path: '/p/.cscode/worktree.json',
      source: 'cscode'
    });
    const result = await getPrompt({ projectPath: '/p', key: 'slash/review' });
    expect(result).toBe('Please review the code in the current context.');
  });

  it('falls back to builtin when prompts field is missing', async () => {
    mockDetect.mockResolvedValue({
      config: { 'setup-worktree': ['bun install'] },
      path: '/p/.cscode/worktree.json',
      source: 'cscode'
    });
    const result = await getPrompt({ projectPath: '/p', key: 'slash/review' });
    expect(result).toBe('Please review the code in the current context.');
  });

  it('falls back to builtin when config is null (no file)', async () => {
    mockDetect.mockResolvedValue({ config: null, path: null, source: null });
    const result = await getPrompt({ projectPath: '/p', key: 'slash/review' });
    expect(result).toBe('Please review the code in the current context.');
  });

  it('falls back to builtin and warns when user template is malformed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDetect.mockResolvedValue({
      config: { prompts: { 'slash/review': '{% if %}broken template' } },
      path: '/p/.cscode/worktree.json',
      source: 'cscode'
    });
    const result = await getPrompt({ projectPath: '/p', key: 'slash/review' });
    expect(result).toBe('Please review the code in the current context.');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[PromptService]'), expect.anything());
    warnSpy.mockRestore();
  });

  it('falls back to builtin and warns when detectWorktreeConfig throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDetect.mockRejectedValue(new Error('File read error'));
    const result = await getPrompt({ projectPath: '/p', key: 'slash/review' });
    expect(result).toBe('Please review the code in the current context.');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[PromptService]'), expect.any(Error));
    warnSpy.mockRestore();
  });

  it('uses builtin without warning when no projectPath provided', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await getPrompt({ key: 'slash/review' });
    expect(result).toBe('Please review the code in the current context.');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
