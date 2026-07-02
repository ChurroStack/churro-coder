export type WorkItemProvider = 'github';

export interface WorkItemLabel {
  name: string;
  color?: string;
}

export interface WorkItem {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: string;
  type: 'issue';
  url: string;
  labels: WorkItemLabel[];
  updatedAt: string;
  createdAt: string;
  provider: WorkItemProvider;
  repoOwner: string;
  repoName: string;
}

export interface WorkItemPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface WorkItemFetchResult {
  items: WorkItem[];
  pageInfo?: WorkItemPageInfo;
  error?: {
    provider?: WorkItemProvider;
    code: 'not-authenticated' | 'permission-denied' | 'cli-missing' | 'network-error' | 'unknown';
    message: string;
    hint?: string;
  };
}
