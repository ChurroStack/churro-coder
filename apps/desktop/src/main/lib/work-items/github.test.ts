import { describe, test, expect } from 'vitest';
import { buildGraphQLQuery } from './github';

describe('buildGraphQLQuery', () => {
  test('queries viewer issues with open-state filtering and pagination', () => {
    const query = buildGraphQLQuery();
    expect(query).toContain('viewer');
    expect(query).toContain('issues(first: 50');
    expect(query).toContain('filterBy: { states: OPEN }');
    expect(query).not.toContain('\n        body\n');
  });

  test('includes the cursor when loading more results', () => {
    const query = buildGraphQLQuery('cursor-123');
    expect(query).toContain('after: "cursor-123"');
  });
});
