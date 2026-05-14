export type ProviderId = 'github' | 'azure' | 'local';

export type ErrorCode =
  | 'not-authenticated'
  | 'cli-missing'
  | 'cli-extension-missing'
  | 'name-conflict'
  | 'target-exists'
  | 'permission-denied'
  | 'network-error'
  | 'unknown';

export type DetectResult = { available: true; version: string } | { available: false; missingExtension?: string };

export type AuthResult = { ok: true } | { ok: false; code: ErrorCode; message: string; hint?: string };

export interface Account {
  id: string;
  label: string;
  badge?: 'Personal';
}

export interface AzureProject {
  id: string;
  name: string;
}

export interface CreateRepoInput {
  name: string;
  description?: string;
  accountId: string;
  projectId?: string;
  visibility?: 'public' | 'private';
  correlationId: string;
}

export type CreateRepoResult =
  | { ok: true; cloneUrl: string; htmlUrl?: string }
  | { ok: false; code: ErrorCode; message: string };

export interface DeleteRepoInput {
  accountId: string;
  name: string;
  correlationId: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  detectCli(correlationId: string): Promise<DetectResult>;
  checkAuth(correlationId: string): Promise<AuthResult>;
  listAccounts(correlationId: string): Promise<Account[]>;
  listProjects(accountId: string, correlationId: string): Promise<AzureProject[] | null>;
  createRepo(input: CreateRepoInput): Promise<CreateRepoResult>;
  getCloneUrl(accountId: string, repoName: string, projectId?: string): string | null;
  /** Optional rollback for createRepo. Adapters that don't implement this leave
   * the orphaned remote repo behind; the compensator becomes a no-op. */
  deleteRepo?(input: DeleteRepoInput): Promise<void>;
}
