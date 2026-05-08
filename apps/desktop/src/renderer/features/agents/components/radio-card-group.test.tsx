// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { Zap, Bug, FileText } from 'lucide-react';
import { RadioCardGroup } from './radio-card-group';
import type { RadioCardOption } from './radio-card-group';

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
