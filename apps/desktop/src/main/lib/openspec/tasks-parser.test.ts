import { describe, expect, test } from 'vitest';
import { parseTaskProgress } from './tasks-parser';

describe('parseTaskProgress', () => {
  test('counts mixed checked / unchecked items', () => {
    const raw = `## 1. Implementation
- [x] 1.1 Done
- [ ] 1.2 Pending
- [X] 1.3 Done with capital X
- [ ] 1.4 Pending
`;
    expect(parseTaskProgress(raw)).toEqual({ total: 4, done: 2 });
  });

  test('counts indented sub-items', () => {
    const raw = `- [ ] 1 Top
  - [x] 1.1 Sub
    - [x] 1.1.1 Deep
  - [ ] 1.2 Sub
`;
    expect(parseTaskProgress(raw)).toEqual({ total: 4, done: 2 });
  });

  test('ignores non-checkbox bullets', () => {
    const raw = `- not a checkbox
- [ ] real
- [x] real done
- bare bullet
`;
    expect(parseTaskProgress(raw)).toEqual({ total: 2, done: 1 });
  });

  test('returns zeros for empty input', () => {
    expect(parseTaskProgress('')).toEqual({ total: 0, done: 0 });
  });

  test('returns zeros for files with no checkboxes', () => {
    expect(parseTaskProgress('## Heading\n\nProse content here.')).toEqual({ total: 0, done: 0 });
  });

  test('handles CRLF line endings', () => {
    expect(parseTaskProgress('- [ ] a\r\n- [x] b\r\n')).toEqual({ total: 2, done: 1 });
  });
});
