/**
 * Work Items Mention Provider
 *
 * Surfaces GitHub issues from the MyWork cache as @ mentions.
 * Selecting an item inserts a short reference like:
 *   #42: Fix login timeout (owner/repo)
 */

import { trpcClient } from '../../../lib/trpc';
import {
  createMentionProvider,
  type MentionItem,
  type MentionSearchContext,
  type MentionSearchResult,
  MENTION_PREFIXES,
  sortByRelevance
} from '../types';
import type { WorkItem } from '../../../main/lib/work-items/types';

export type { WorkItem as WorkItemData };

// Coalesces rapid consecutive @-mention searches into one IPC call.
let searchInFlight: Promise<WorkItemFetchResult> | null = null;

function makeItemId(item: WorkItem): string {
  return `${MENTION_PREFIXES.GITHUB_ISSUE}${item.repoOwner}/${item.repoName}#${item.number}`;
}

function makeShortRef(item: WorkItem): string {
  return `#${item.number}: ${item.title} (${item.repoOwner}/${item.repoName})`;
}

export const workItemsProvider = createMentionProvider<WorkItem>({
  id: 'work-items',
  name: 'My Work',
  category: {
    id: 'work-items',
    label: 'My Work',
    priority: 85
  },
  trigger: {
    char: '@',
    position: 'standalone',
    allowSpaces: true
  },
  priority: 85,

  async search(context: MentionSearchContext): Promise<MentionSearchResult<WorkItem>> {
    const startTime = performance.now();

    if (context.signal.aborted) {
      return { items: [], hasMore: false, timing: 0 };
    }

    try {
      if (!searchInFlight) {
        searchInFlight = trpcClient.workItems.list.query().finally(() => {
          searchInFlight = null;
        });
      }
      const result = await searchInFlight;
      const allItems = result.items ?? [];

      let items: MentionItem<WorkItem>[] = allItems.map((item) => ({
        id: makeItemId(item),
        label: `#${item.number}: ${item.title}`,
        description: `${item.repoOwner}/${item.repoName}`,
        icon: 'tool',
        data: item,
        keywords: [item.repoOwner, item.repoName, `#${item.number}`, item.title],
        metadata: { type: 'tool' as const, repository: `${item.repoOwner}/${item.repoName}` }
      }));

      if (context.query) {
        items = sortByRelevance(items, context.query);
      }

      return {
        items: items.slice(0, context.limit),
        hasMore: items.length > context.limit,
        totalCount: allItems.length,
        timing: performance.now() - startTime
      };
    } catch (error) {
      console.error('[WorkItemsProvider] Search error:', error);
      return { items: [], hasMore: false, timing: performance.now() - startTime };
    }
  },

  /**
   * The serialized form is the human-readable short reference so that
   * the AI agent sees useful context even if the token isn't expanded.
   */
  serialize(item: MentionItem<WorkItem>): string {
    const ref = makeShortRef(item.data);
    if (!item.data.body) return ref;
    const body = item.data.body.length > 2000 ? item.data.body.slice(0, 2000) + '…' : item.data.body;
    return `${ref}\n\n${body}`;
  },

  deserialize(): MentionItem<WorkItem> | null {
    // Work items are ephemeral — no need to reconstruct from stored tokens.
    return null;
  },

  isAvailable() {
    return true;
  }
});

export default workItemsProvider;

/**
 * Build a short reference string from a WorkItem — used by both the
 * mention provider and the work items panel insertion.
 */
export { makeShortRef as workItemShortRef };
