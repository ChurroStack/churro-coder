// @vitest-environment jsdom
/**
 * Agent-CLI states for the shared CliInstallInstructions component:
 * missing → install command; installed-but-outdated → upgrade box; installed-OK
 * → status row (only with showWhenAvailable). Covers claude/codex/openspec.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { createTestStore, renderWithProviders } from '../../../../test-utils';
import { CliInstallInstructions, commandToCopy } from './cli-install-instructions';

afterEach(cleanup);

const mockDetectCliQuery = vi.fn(() => ({
  data: undefined as
    | { available: boolean; version?: string; requiredVersion?: string; meetsMinimum?: boolean }
    | undefined,
  isFetching: false
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      newProject: { detectCli: { invalidate: vi.fn(), fetch: vi.fn(), setData: vi.fn() } }
    })),
    newProject: {
      detectCli: { useQuery: (...a: unknown[]) => (mockDetectCliQuery as (...args: unknown[]) => unknown)(...a) }
    }
  }
}));

const mockGetPlatform = vi.fn<() => 'darwin' | 'win32' | 'linux' | 'unknown'>(() => 'darwin');
vi.mock('@/lib/utils/platform', () => ({ getPlatform: () => mockGetPlatform() }));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlatform.mockReturnValue('darwin');
});

function render(provider: 'claude' | 'codex' | 'openspec', showWhenAvailable = false) {
  const store = createTestStore();
  renderWithProviders(<CliInstallInstructions provider={provider} showWhenAvailable={showWhenAvailable} />, { store });
}

describe('commandToCopy — strips display-only markers', () => {
  it('drops the leading "# or: " fallback marker so only the command is copied', () => {
    expect(commandToCopy('# or: npm install -g @anthropic-ai/claude-code')).toBe(
      'npm install -g @anthropic-ai/claude-code'
    );
  });

  it('drops a trailing "  # platform" annotation', () => {
    expect(commandToCopy('sudo apt install gh  # Debian/Ubuntu')).toBe('sudo apt install gh');
    expect(commandToCopy('# or: sudo dnf install gh  # Fedora')).toBe('sudo dnf install gh');
  });

  it('leaves a plain command untouched', () => {
    expect(commandToCopy('curl -fsSL https://claude.ai/install.sh | bash')).toBe(
      'curl -fsSL https://claude.ai/install.sh | bash'
    );
  });
});

describe('CliInstallInstructions — agent CLI missing', () => {
  it('shows the macOS install command for claude when not installed', () => {
    mockDetectCliQuery.mockReturnValue({
      data: { available: false, requiredVersion: '2.1.156', meetsMinimum: false },
      isFetching: false
    });
    render('claude', true);
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy();
    expect(screen.getByRole('button', { name: /recheck/i })).toBeTruthy();
  });

  it('shows the brew install command for codex on macOS', () => {
    mockDetectCliQuery.mockReturnValue({
      data: { available: false, requiredVersion: '0.135.0', meetsMinimum: false },
      isFetching: false
    });
    render('codex', true);
    expect(screen.getByText('brew install codex')).toBeTruthy();
  });

  it('shows the npm install command for openspec', () => {
    mockDetectCliQuery.mockReturnValue({
      data: { available: false, requiredVersion: '1.3.1', meetsMinimum: false },
      isFetching: false
    });
    render('openspec', true);
    expect(screen.getByText('npm install -g @fission-ai/openspec')).toBeTruthy();
  });
});

describe('CliInstallInstructions — agent CLI outdated', () => {
  it('shows an upgrade box naming current vs required version', () => {
    mockDetectCliQuery.mockReturnValue({
      data: { available: true, version: '2.0.0', requiredVersion: '2.1.156', meetsMinimum: false },
      isFetching: false
    });
    render('claude', true);
    expect(screen.getByText(/v2\.0\.0 is below the required v2\.1\.156/)).toBeTruthy();
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy();
  });
});

describe('CliInstallInstructions — agent CLI installed & OK', () => {
  it('renders a status row with version when showWhenAvailable', () => {
    mockDetectCliQuery.mockReturnValue({
      data: { available: true, version: '2.1.156', requiredVersion: '2.1.156', meetsMinimum: true },
      isFetching: false
    });
    render('claude', true);
    expect(screen.getByText('Claude Code CLI detected')).toBeTruthy();
    expect(screen.getByText('· v2.1.156')).toBeTruthy();
  });

  it('renders nothing when installed and showWhenAvailable is false', () => {
    mockDetectCliQuery.mockReturnValue({
      data: { available: true, version: '2.1.156', requiredVersion: '2.1.156', meetsMinimum: true },
      isFetching: false
    });
    const { container } = renderWithProviders(<CliInstallInstructions provider="claude" />, {
      store: createTestStore()
    });
    expect(container.textContent).toBe('');
  });
});
