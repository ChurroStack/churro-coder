import { trpcClient } from '../../lib/trpc';
import type { WorkItem } from '../../../main/lib/work-items/types';

function formatIssueSessionMessage(item: WorkItem, body?: string): string {
  const trimmedBody = body?.trim();
  return `I'm working on #${item.number}: ${item.title}\n\n${trimmedBody ? `${trimmedBody}\n\n` : ''}${item.url}`;
}

export async function resolveIssueSessionMessage(item: WorkItem): Promise<string> {
  try {
    const { body } = await trpcClient.workItems.getDetail.query({
      owner: item.repoOwner,
      repo: item.repoName,
      number: item.number
    });
    return formatIssueSessionMessage(item, body);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[my-work] issue-detail-fetch-fallback issue=${item.repoOwner}/${item.repoName}#${item.number} reason="${reason.slice(0, 200)}"`
    );
    return formatIssueSessionMessage(item, item.body);
  }
}
