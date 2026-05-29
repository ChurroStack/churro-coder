import { describe, expect, it } from 'vitest';
import { deriveSubChatIconKind } from './sub-chat-icon-status';

describe('deriveSubChatIconKind', () => {
  it('returns idle when no signals are set', () => {
    expect(deriveSubChatIconKind({ hasError: false, isBusy: false, needsInput: false })).toBe('idle');
  });

  it('returns busy when streaming with no other signals', () => {
    expect(deriveSubChatIconKind({ hasError: false, isBusy: true, needsInput: false })).toBe('busy');
  });

  it('returns needs-input when only needs-input is set', () => {
    expect(deriveSubChatIconKind({ hasError: false, isBusy: false, needsInput: true })).toBe('needs-input');
  });

  it('returns busy when streaming AND needs-input are both true (spinner wins)', () => {
    expect(deriveSubChatIconKind({ hasError: false, isBusy: true, needsInput: true })).toBe('busy');
  });

  it('returns error when error is set regardless of other signals', () => {
    expect(deriveSubChatIconKind({ hasError: true, isBusy: false, needsInput: false })).toBe('error');
    expect(deriveSubChatIconKind({ hasError: true, isBusy: true, needsInput: false })).toBe('error');
    expect(deriveSubChatIconKind({ hasError: true, isBusy: false, needsInput: true })).toBe('error');
    expect(deriveSubChatIconKind({ hasError: true, isBusy: true, needsInput: true })).toBe('error');
  });
});
