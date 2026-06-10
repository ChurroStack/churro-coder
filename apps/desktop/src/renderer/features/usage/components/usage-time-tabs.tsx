import { useAtom } from 'jotai';
import { desktopViewAtom } from '../../agents/atoms';
import { SegmentedToggle } from './segmented-toggle';

const TABS = [
  { value: 'usage' as const, label: 'Usage' },
  { value: 'time' as const, label: 'Time' }
];

/**
 * Shared tab bar that switches between the Usage and Time surfaces. Both pages
 * are distinct `desktopView`s; the bar just flips `desktopViewAtom`, so it reads
 * as one persistent tab strip across the two pages (and lets the left sidebar
 * expose a single Usage entry point instead of two icons).
 */
export function UsageTimeTabs() {
  const [view, setView] = useAtom(desktopViewAtom);
  const active = view === 'time' ? 'time' : 'usage';
  return <SegmentedToggle value={active} onChange={(v) => setView(v)} options={TABS} size="sm" />;
}
