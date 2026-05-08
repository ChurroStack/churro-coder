// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getInitialWindowParams } from './WindowContext';

describe('getInitialWindowParams', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('reads projectId from the query string and consumes it once', () => {
    window.history.replaceState({}, '', '/?windowId=main&chatId=chat-1&subChatId=sub-1&projectId=project-1');

    expect(getInitialWindowParams()).toEqual({
      chatId: 'chat-1',
      subChatId: 'sub-1',
      projectId: 'project-1'
    });
    expect(getInitialWindowParams()).toEqual({});
  });

  it('reads projectId from the URL hash (production file:// URLs)', () => {
    window.history.replaceState({}, '', '/#chatId=chat-2&subChatId=sub-2&projectId=project-2');

    expect(getInitialWindowParams()).toEqual({
      chatId: 'chat-2',
      subChatId: 'sub-2',
      projectId: 'project-2'
    });
    expect(getInitialWindowParams()).toEqual({});
  });

  it('marks params as consumed when only projectId is present', () => {
    window.history.replaceState({}, '', '/?projectId=project-3');

    expect(getInitialWindowParams()).toEqual({ projectId: 'project-3' });
    expect(getInitialWindowParams()).toEqual({});
  });
});
