import { runCli } from '../providers/cli-runner';
import { getCachedDetect, setCachedDetect, getCachedAuth, setCachedAuth } from '../providers/detect-cache';
import type { WorkItem, WorkItemFetchResult } from './types';

function log(op: string, ok: boolean, reason?: string): void {
  const suffix = ok ? '' : ` reason="${reason?.split('\n')[0].slice(0, 200)}"`;
  console.log(`[work-items:github] op=${op} ok=${ok}${suffix}`);
}

async function detectCli(): Promise<boolean> {
  const cached = getCachedDetect('github');
  if (cached) return cached.available;

  const result = await runCli('gh', ['--version'], { timeoutMs: 5_000 });
  if (result.code === 0) {
    const version = result.stdout.split('\n')[0]?.match(/gh version ([^\s]+)/)?.[1] ?? 'unknown';
    setCachedDetect('github', { available: true, version });
    return true;
  }
  setCachedDetect('github', { available: false });
  return false;
}

async function checkAuth(): Promise<boolean> {
  const cached = getCachedAuth('github');
  if (cached) return cached.ok;

  const result = await runCli('gh', ['auth', 'status']);
  const ok = result.code === 0;
  setCachedAuth(
    'github',
    ok
      ? { ok: true }
      : { ok: false, code: 'not-authenticated', message: result.stderr.split('\n')[0] ?? 'Not authenticated' }
  );
  return ok;
}

export function buildGraphQLQuery(after?: string): string {
  const afterArg = after ? `, after: "${after}"` : '';
  return `{
  viewer {
    issues(first: 50${afterArg}, filterBy: { states: OPEN }, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        url
        repository {
          owner { login }
          name
        }
        labels(first: 5) { nodes { name color } }
        updatedAt
        createdAt
      }
    }
  }
}`;
}

interface GhIssueNode {
  number: number;
  title: string;
  state: string;
  url: string;
  repository: { owner: { login: string }; name: string };
  labels: { nodes: Array<{ name: string; color: string }> };
  updatedAt: string;
  createdAt: string;
}

export async function fetchGitHubWorkItems(after?: string): Promise<WorkItemFetchResult> {
  const available = await detectCli();
  if (!available) {
    log('fetchWorkItems', false, 'cli-missing');
    return {
      items: [],
      error: {
        provider: 'github',
        code: 'cli-missing',
        message: 'GitHub CLI (gh) is not installed.',
        hint: 'Install it with: brew install gh'
      }
    };
  }

  const authed = await checkAuth();
  if (!authed) {
    log('fetchWorkItems', false, 'not-authenticated');
    return {
      items: [],
      error: {
        provider: 'github',
        code: 'not-authenticated',
        message: 'Not authenticated with GitHub.',
        hint: 'Run: gh auth login'
      }
    };
  }

  const result = await runCli('gh', ['api', 'graphql', '-f', `query=${buildGraphQLQuery(after)}`], {
    timeoutMs: 15_000
  });

  if (result.code !== 0) {
    const stderr = result.stderr;
    if (stderr.includes('INSUFFICIENT_SCOPES') || stderr.includes('scope')) {
      log('fetchWorkItems', false, 'permission-denied');
      return {
        items: [],
        error: {
          provider: 'github',
          code: 'permission-denied',
          message: 'Your GitHub token lacks the repo scope to read issues.',
          hint: 'Run: gh auth refresh -s repo'
        }
      };
    }
    if (result.code === 124) {
      log('fetchWorkItems', false, 'network-error');
      return {
        items: [],
        error: {
          provider: 'github',
          code: 'network-error',
          message: 'Request timed out. Check your network connection.'
        }
      };
    }
    log('fetchWorkItems', false, stderr);
    return {
      items: [],
      error: { provider: 'github', code: 'unknown', message: stderr.split('\n')[0] ?? 'Unknown error' }
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      data?: {
        viewer?: { issues?: { nodes?: GhIssueNode[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } } };
      };
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };

    if (parsed.errors?.length) {
      const firstError = parsed.errors[0];
      const code = firstError?.extensions?.code;
      if (code === 'INSUFFICIENT_SCOPES') {
        return {
          items: [],
          error: {
            provider: 'github',
            code: 'permission-denied',
            message: 'Insufficient scopes.',
            hint: 'Run: gh auth refresh -s repo'
          }
        };
      }
      log('fetchWorkItems', false, firstError?.message);
      return {
        items: [],
        error: { provider: 'github', code: 'unknown', message: firstError?.message ?? 'GraphQL error' }
      };
    }

    const issuesData = parsed.data?.viewer?.issues;
    const nodes = issuesData?.nodes ?? [];
    const rawPageInfo = issuesData?.pageInfo;
    const items: WorkItem[] = nodes.map((node) => ({
      id: `github:${node.repository.owner.login}/${node.repository.name}#${node.number}`,
      number: node.number,
      title: node.title,
      state: node.state,
      type: 'issue' as const,
      url: node.url,
      labels: node.labels.nodes.map((l) => ({ name: l.name, color: l.color })),
      updatedAt: node.updatedAt,
      createdAt: node.createdAt,
      provider: 'github' as const,
      repoOwner: node.repository.owner.login,
      repoName: node.repository.name
    }));

    log('fetchWorkItems', true);
    return {
      items,
      pageInfo: {
        hasNextPage: rawPageInfo?.hasNextPage ?? false,
        endCursor: rawPageInfo?.endCursor ?? null
      }
    };
  } catch {
    log('fetchWorkItems', false, 'json parse error');
    return { items: [], error: { provider: 'github', code: 'unknown', message: 'Failed to parse GitHub response.' } };
  }
}

export async function fetchIssueBody(owner: string, repo: string, number: number): Promise<string> {
  const available = await detectCli();
  if (!available) {
    log('fetchIssueBody', false, 'cli-missing');
    throw new Error('GitHub CLI (gh) is not installed.');
  }

  const authed = await checkAuth();
  if (!authed) {
    log('fetchIssueBody', false, 'not-authenticated');
    throw new Error('Not authenticated with GitHub.');
  }

  const result = await runCli('gh', ['api', `repos/${owner}/${repo}/issues/${number}`, '--jq', '.body // ""'], {
    timeoutMs: 15_000
  });

  if (result.code !== 0) {
    const reason = result.stderr.split('\n')[0] ?? 'Unknown error';
    log('fetchIssueBody', false, reason);
    throw new Error(`Failed to fetch issue body for ${owner}/${repo}#${number}: ${reason}`);
  }

  log('fetchIssueBody', true);
  return result.stdout.trimEnd();
}
