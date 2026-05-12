// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import { isActive, reasonFor } from './chat-tab-priority-sync';
import type { StreamingStatus } from '../agents/stores/streaming-status-store';

const noQ = new Set<string>();
const noPlan = new Set<string>();

describe('isActive', () => {
  test('ready or missing status with no pending → inactive', () => {
    expect(isActive('sc-1', {}, noQ, noPlan)).toBe(false);
    expect(isActive('sc-1', { 'sc-1': 'ready' } as Record<string, StreamingStatus>, noQ, noPlan)).toBe(false);
  });

  test('streaming → active', () => {
    expect(isActive('sc-1', { 'sc-1': 'streaming' } as Record<string, StreamingStatus>, noQ, noPlan)).toBe(true);
  });

  test('submitted → active', () => {
    expect(isActive('sc-1', { 'sc-1': 'submitted' } as Record<string, StreamingStatus>, noQ, noPlan)).toBe(true);
  });

  test('error → active', () => {
    expect(isActive('sc-1', { 'sc-1': 'error' } as Record<string, StreamingStatus>, noQ, noPlan)).toBe(true);
  });

  test('pending user question → active even when status is ready', () => {
    expect(isActive('sc-1', {}, new Set(['sc-1']), noPlan)).toBe(true);
  });

  test('pending plan approval → active even when status is ready', () => {
    expect(isActive('sc-1', {}, noQ, new Set(['sc-1']))).toBe(true);
  });

  test('only matches the target subChatId', () => {
    expect(
      isActive('sc-1', { 'sc-2': 'streaming' } as Record<string, StreamingStatus>, new Set(['sc-2']), new Set(['sc-2']))
    ).toBe(false);
  });
});

describe('reasonFor', () => {
  test('streaming/submitted → "streaming"', () => {
    expect(reasonFor('sc-1', { 'sc-1': 'streaming' } as Record<string, StreamingStatus>, noQ, noPlan)).toBe(
      'streaming'
    );
    expect(reasonFor('sc-1', { 'sc-1': 'submitted' } as Record<string, StreamingStatus>, noQ, noPlan)).toBe(
      'streaming'
    );
  });

  test('error → "error"', () => {
    expect(reasonFor('sc-1', { 'sc-1': 'error' } as Record<string, StreamingStatus>, noQ, noPlan)).toBe('error');
  });

  test('pending question / approval (and otherwise ready) → "needs-input"', () => {
    expect(reasonFor('sc-1', {}, new Set(['sc-1']), noPlan)).toBe('needs-input');
    expect(reasonFor('sc-1', {}, noQ, new Set(['sc-1']))).toBe('needs-input');
  });

  test('streaming takes priority over needs-input when both are true', () => {
    expect(
      reasonFor('sc-1', { 'sc-1': 'streaming' } as Record<string, StreamingStatus>, new Set(['sc-1']), noPlan)
    ).toBe('streaming');
  });
});
