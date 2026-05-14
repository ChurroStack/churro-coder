import type { ProviderId } from './types';
import { isMacOS, isWindows } from '../platform/index';

export interface InstallInstructions {
  summary: string;
  steps: string[];
  url: string;
}

export function getInstallInstructions(provider: ProviderId): InstallInstructions {
  if (provider === 'github') {
    if (isMacOS()) {
      return {
        summary: 'Install the GitHub CLI (gh)',
        steps: ['brew install gh', 'gh auth login'],
        url: 'https://cli.github.com'
      };
    }
    if (isWindows()) {
      return {
        summary: 'Install the GitHub CLI (gh)',
        steps: ['winget install --id GitHub.cli', 'gh auth login'],
        url: 'https://cli.github.com'
      };
    }
    return {
      summary: 'Install the GitHub CLI (gh)',
      steps: ['sudo apt install gh  # Debian/Ubuntu', '# or: sudo dnf install gh  # Fedora', 'gh auth login'],
      url: 'https://cli.github.com'
    };
  }

  if (provider === 'azure') {
    if (isMacOS()) {
      return {
        summary: 'Install Azure CLI and the azure-devops extension',
        steps: ['brew install azure-cli', 'az extension add --name azure-devops', 'az login'],
        url: 'https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos'
      };
    }
    if (isWindows()) {
      return {
        summary: 'Install Azure CLI and the azure-devops extension',
        steps: ['winget install Microsoft.AzureCLI', 'az extension add --name azure-devops', 'az login'],
        url: 'https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows'
      };
    }
    return {
      summary: 'Install Azure CLI and the azure-devops extension',
      steps: [
        'curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash',
        'az extension add --name azure-devops',
        'az login'
      ],
      url: 'https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux'
    };
  }

  // local — git
  if (isMacOS()) {
    return {
      summary: 'Install Git',
      steps: ['xcode-select --install', '# or: brew install git'],
      url: 'https://git-scm.com/download/mac'
    };
  }
  if (isWindows()) {
    return {
      summary: 'Install Git',
      steps: ['winget install --id Git.Git'],
      url: 'https://git-scm.com/download/win'
    };
  }
  return {
    summary: 'Install Git',
    steps: ['sudo apt install git  # Debian/Ubuntu', '# or: sudo dnf install git  # Fedora'],
    url: 'https://git-scm.com/download/linux'
  };
}

export function getMissingExtensionInstructions(provider: ProviderId): InstallInstructions | null {
  if (provider !== 'azure') return null;

  return {
    summary: 'Install the azure-devops CLI extension',
    steps: ['az extension add --name azure-devops'],
    url: 'https://learn.microsoft.com/en-us/azure/devops/cli'
  };
}
