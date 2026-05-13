import type { ProviderId, ProviderAdapter } from './types';
import { GitHubAdapter } from './github';
import { AzureDevOpsAdapter } from './azure-devops';
import { LocalAdapter } from './local';

const adapters: Record<ProviderId, ProviderAdapter> = {
  github: new GitHubAdapter(),
  azure: new AzureDevOpsAdapter(),
  local: new LocalAdapter()
};

export function getProviderAdapter(id: ProviderId): ProviderAdapter {
  return adapters[id];
}

export type { ProviderId, ProviderAdapter };
export { GitHubAdapter } from './github';
export { AzureDevOpsAdapter } from './azure-devops';
export { LocalAdapter } from './local';
