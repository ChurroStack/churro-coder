import { describe, test, expect } from 'vitest';
import { makeScopeKey } from './scope-key';

describe('makeScopeKey', () => {
  test('always emits the same deterministic shape', () => {
    expect(makeScopeKey('plan', { subChatId: 'sc-1' })).toBe('t:plan|p:|w:|c:|s:sc-1');
    expect(makeScopeKey('terminal', { chatId: 'chat-1', worktreePath: '/wt' })).toBe('t:terminal|p:|w:/wt|c:chat-1|s:');
    expect(makeScopeKey('panel', { projectId: 'p1', worktreePath: '/w', chatId: 'c1', subChatId: 's1' })).toBe(
      't:panel|p:p1|w:/w|c:c1|s:s1'
    );
  });

  test('null/undefined dims serialise to the same empty segment', () => {
    expect(makeScopeKey('plan', { subChatId: 'sc-1' })).toBe(
      makeScopeKey('plan', { chatId: undefined, subChatId: 'sc-1' })
    );
    expect(makeScopeKey('plan', { chatId: null, subChatId: 'sc-1' })).toBe(
      makeScopeKey('plan', { chatId: undefined, subChatId: 'sc-1' })
    );
  });

  test('a producer key and a consumer key for the same family are byte-identical', () => {
    // Producer (e.g. agent-plan-file-tool) and consumer (e.g. details-rail)
    // must derive the exact same key for the same sub-chat.
    const producerKey = makeScopeKey('plan', { subChatId: 'sc-42' });
    const consumerKey = makeScopeKey('plan', { subChatId: 'sc-42' });
    expect(producerKey).toBe(consumerKey);
  });

  test('two families with the same identity differ only in the t: segment', () => {
    const plan = makeScopeKey('plan', { subChatId: 'sc-1' });
    const todos = makeScopeKey('todos', { subChatId: 'sc-1' });
    expect(plan).not.toBe(todos);
    expect(plan.replace('t:plan', 't:X')).toBe(todos.replace('t:todos', 't:X'));
  });

  test('a chatId can never collide with a subChatId of the same string', () => {
    // The old `subChatId ?? chatId` bug: "id-9" used as both. Now they are
    // distinguished by the labeled segment.
    expect(makeScopeKey('plan', { chatId: 'id-9' })).not.toBe(makeScopeKey('plan', { subChatId: 'id-9' }));
  });
});
