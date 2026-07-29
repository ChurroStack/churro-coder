// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';

vi.stubGlobal('api', { invoke: vi.fn(), on: vi.fn(), off: vi.fn() });

vi.mock('@/lib/trpc', () => ({
  trpc: {
    chats: {
      getReviewContent: {
        useQuery: () => ({
          data: {
            exists: true,
            content:
              '# Code Review\n\n## Summary\n\nThree issues need attention.\n\n## Issues Found\n\n| Severity | File:Line | Issue | Suggestion |\n|---|---|---|---|\n| 🔴 high | src/auth.ts:42 | Missing authorization | Check ownership |\n| 🟡 medium | src/cache.ts:8 | Cache leak | Evict entries |\n| 🟢 low | src/log.ts:3 | Ambiguous log | Name the event |'
          }
        })
      }
    }
  }
}));

vi.mock('../../dock', () => ({
  useWidgetPanel: () => ({ isOpen: false, closePanel: vi.fn(), openAsPanel: vi.fn() })
}));

import { ReviewWidget } from './review-widget';

afterEach(cleanup);

describe('Review widget [cli-harness/completed-native-reviews]', () => {
  test('exposes canonical severity, file, issue, and suggestion findings accessibly', () => {
    render(<ReviewWidget activeSubChatId="sub-review-widget" />);

    const region = screen.getByRole('region', { name: 'Review' });
    expect(within(region).getByRole('heading', { name: 'Summary' })).toBeTruthy();
    expect(within(region).getByText('Three issues need attention.')).toBeTruthy();
    const table = within(region).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Severity' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'File:Line' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Issue' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Suggestion' })).toBeTruthy();
    expect(within(table).getByText('🔴 high')).toBeTruthy();
    expect(within(table).getByText('🟡 medium')).toBeTruthy();
    expect(within(table).getByText('🟢 low')).toBeTruthy();
    expect(within(table).getByText('src/auth.ts:42')).toBeTruthy();
    expect(within(table).getByText('Missing authorization')).toBeTruthy();
    expect(within(table).getByText('Check ownership')).toBeTruthy();
  });
});
