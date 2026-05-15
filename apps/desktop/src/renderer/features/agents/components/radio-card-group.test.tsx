// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { Zap, Bug, FileText, Sparkles, ClipboardList } from 'lucide-react';
import { RadioCardGroup } from './radio-card-group';
import type { RadioCardOption } from './radio-card-group';
import type { WizardTemplate } from '../lib/wizard-state';

afterEach(cleanup);

type TestValue = 'a' | 'b' | 'c';

const options: RadioCardOption<TestValue>[] = [
  { value: 'a', label: 'Alpha', description: 'First option', icon: Zap },
  { value: 'b', label: 'Beta', description: 'Second option', icon: Bug },
  { value: 'c', label: 'Gamma', description: 'Third option', icon: FileText }
];

describe('RadioCardGroup', () => {
  it('renders all options', () => {
    const { getByText } = render(<RadioCardGroup value="a" onChange={vi.fn()} options={options} />);
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
    expect(getByText('Gamma')).toBeTruthy();
  });

  it('selected option has aria-checked true', () => {
    const { getAllByRole } = render(<RadioCardGroup value="b" onChange={vi.fn()} options={options} />);
    const radios = getAllByRole('radio');
    expect(radios[0]?.getAttribute('aria-checked')).toBe('false');
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[2]?.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking unselected option calls onChange with new value', () => {
    const onChange = vi.fn();
    const { getByText } = render(<RadioCardGroup value="a" onChange={onChange} options={options} />);
    fireEvent.click(getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('does not call onChange when clicking already-selected option', () => {
    const onChange = vi.fn();
    const { getByText } = render(<RadioCardGroup value="a" onChange={onChange} options={options} />);
    fireEvent.click(getByText('Alpha'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// Snapshot test: locks the rendering of the vibe-coding | spec-driven card selector
// to detect accidental label, structure, or behavior changes (task 8.1).
const harnessOptions: RadioCardOption<WizardTemplate>[] = [
  {
    value: 'vibe-coding',
    label: 'Vibe coding',
    description: 'Use a fast, prompt-first implementation flow.',
    icon: Sparkles
  },
  {
    value: 'spec-driven',
    label: 'Spec-driven',
    description: 'Work from an OpenSpec change with tighter structure.',
    icon: ClipboardList
  }
];

describe('RadioCardGroup — harness card selector snapshot', () => {
  it('renders vibe-coding and spec-driven cards with expected labels and descriptions', () => {
    const { getAllByRole, getByText } = render(
      <RadioCardGroup<WizardTemplate> value="vibe-coding" onChange={vi.fn()} options={harnessOptions} columns={2} />
    );
    const radios = getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[1]?.getAttribute('aria-checked')).toBe('false');
    expect(getByText('Vibe coding')).toBeTruthy();
    expect(getByText('Use a fast, prompt-first implementation flow.')).toBeTruthy();
    expect(getByText('Spec-driven')).toBeTruthy();
    expect(getByText('Work from an OpenSpec change with tighter structure.')).toBeTruthy();
  });

  it('matches snapshot when vibe-coding is selected', () => {
    const { container } = render(
      <RadioCardGroup<WizardTemplate> value="vibe-coding" onChange={vi.fn()} options={harnessOptions} columns={2} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
