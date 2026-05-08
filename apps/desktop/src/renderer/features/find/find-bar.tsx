import { ChevronDown, ChevronUp, X } from 'lucide-react';
import * as React from 'react';
import { useEffect, useRef } from 'react';

import { cn } from '../../lib/utils';

interface FindBarProps {
  isOpen: boolean;
  query: string;
  current: number;
  total: number;
  selectionVersion: number;
  searchCompleted?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function FindBar({
  isOpen,
  query,
  current,
  total,
  selectionVersion,
  searchCompleted = true,
  placeholder = 'Find...',
  className,
  style,
  onQueryChange,
  onClose,
  onNext,
  onPrev
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen, selectionVersion]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border border-border bg-background p-1.5 shadow-lg',
        className
      )}
      style={style}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
              onPrev();
            } else {
              onNext();
            }
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            onNext();
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            onPrev();
          }
        }}
        placeholder={placeholder}
        className="w-40 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <div className="w-[96px] text-right text-xs text-muted-foreground">
        {total > 0 ? `${current} of ${total}` : query.trim() && searchCompleted ? 'No results' : ''}
      </div>
      <button
        type="button"
        onClick={onPrev}
        className="rounded p-1 hover:bg-muted"
        title="Previous match (Shift+Enter)">
        <ChevronUp className="h-4 w-4 text-muted-foreground" />
      </button>
      <button type="button" onClick={onNext} className="rounded p-1 hover:bg-muted" title="Next match (Enter)">
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
      <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted" title="Close (Escape)">
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}
