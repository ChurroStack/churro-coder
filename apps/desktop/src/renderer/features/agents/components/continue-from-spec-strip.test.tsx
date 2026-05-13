// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../../test-utils';
import { ContinueFromSpecStrip } from './continue-from-spec-strip';
import type { ChangeSummary } from '../../../../main/lib/openspec/types';

afterEach(cleanup);

function makeChange(id: string): ChangeSummary {
  return {
    changeId: id,
    path: `/openspec/changes/${id}`,
    hasProposal: true,
    hasTasks: false,
    hasDesign: false,
    capabilities: [],
    modifiedAt: new Date().toISOString(),
    proposal: {
      changeId: id,
      title: `Title ${id}`,
      why: `Why ${id}`,
      whatChanges: [],
      attributes: {}
    }
  };
}

const noop = vi.fn();

describe('ContinueFromSpecStrip', () => {
  it('renders nothing when changes list is empty and not loading', () => {
    const { container } = renderWithProviders(
      <ContinueFromSpecStrip changes={[]} isLoading={false} selectedSpecId={null} onSelectSpec={noop} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders skeleton placeholders while loading', () => {
    const { getByLabelText } = renderWithProviders(
      <ContinueFromSpecStrip changes={[]} isLoading={true} selectedSpecId={null} onSelectSpec={noop} />
    );
    expect(getByLabelText('Loading specs')).toBeTruthy();
  });

  it('renders up to 4 spec cards when data arrives', () => {
    const changes = [1, 2, 3, 4, 5].map((i) => makeChange(`c${i}`));
    const { getByText, queryByText } = renderWithProviders(
      <ContinueFromSpecStrip changes={changes} isLoading={false} selectedSpecId={null} onSelectSpec={noop} />
    );
    expect(getByText('Title c1')).toBeTruthy();
    expect(getByText('Title c4')).toBeTruthy();
    // 5th card should not render (only top 4)
    expect(queryByText('Title c5')).toBeNull();
  });

  it('clicking chevron collapses and expands the strip', () => {
    const changes = [makeChange('x1'), makeChange('x2')];
    const { getByText, queryByText } = renderWithProviders(
      <ContinueFromSpecStrip changes={changes} isLoading={false} selectedSpecId={null} onSelectSpec={noop} />
    );
    // Initially expanded (default atom value is true)
    expect(getByText('Title x1')).toBeTruthy();

    // Click header to collapse
    fireEvent.click(getByText('Continue from a spec'));
    expect(queryByText('Title x1')).toBeNull();

    // Click again to expand
    fireEvent.click(getByText('Continue from a spec'));
    expect(getByText('Title x1')).toBeTruthy();
  });

  it('"See all N specs" button appears when there are more than 4 changes', () => {
    const changes = [1, 2, 3, 4, 5].map((i) => makeChange(`s${i}`));
    const { getByText } = renderWithProviders(
      <ContinueFromSpecStrip changes={changes} isLoading={false} selectedSpecId={null} onSelectSpec={noop} />
    );
    expect(getByText('Or browse all 5 specs')).toBeTruthy();
  });
});
