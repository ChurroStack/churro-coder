import { FindBar } from '../find/find-bar';

interface TerminalSearchProps {
  isOpen: boolean;
  query: string;
  selectionVersion: number;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onNext: () => void;
  onPrev: () => void;
}

export function TerminalSearch({
  isOpen,
  query,
  selectionVersion,
  onClose,
  onQueryChange,
  onNext,
  onPrev
}: TerminalSearchProps) {
  return (
    <FindBar
      isOpen={isOpen}
      query={query}
      current={0}
      total={0}
      searchCompleted={false}
      selectionVersion={selectionVersion}
      onQueryChange={onQueryChange}
      onClose={onClose}
      onNext={onNext}
      onPrev={onPrev}
    />
  );
}
