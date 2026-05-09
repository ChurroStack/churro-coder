import { describe, test, expect } from 'vitest';
import {
  deriveKanbanStatus,
  deriveAttentionReason,
  type KanbanInput,
  type KanbanAttentionSignals
} from './kanban-state-machine';

const noSignals: KanbanAttentionSignals = {
  workspacesWithPendingQuestions: new Set(),
  workspacesWithPendingApprovals: new Set(),
  workspacesWithUnseenChanges: new Set()
};

function chatInput(
  partial: Partial<Extract<KanbanInput, { kind: 'chat' }>> & { chatId?: string }
): Extract<KanbanInput, { kind: 'chat' }> {
  return {
    kind: 'chat',
    chatId: partial.chatId ?? 'chat-1',
    archivedAt: partial.archivedAt ?? null,
    prUrl: partial.prUrl ?? null,
    latestActiveSubChat: partial.latestActiveSubChat ?? null,
    isLoading: partial.isLoading ?? false
  };
}

// ── deriveKanbanStatus ───────────────────────────────────────────────────────

describe('deriveKanbanStatus', () => {
  // Non-visible draft → null (caller drops the card)
  test('non-visible draft → null', () => {
    expect(deriveKanbanStatus({ kind: 'draft', isVisible: false })).toBeNull();
  });

  test('visible draft → draft', () => {
    expect(deriveKanbanStatus({ kind: 'draft', isVisible: true })).toBe('draft');
  });

  // Precedence: archived wins over everything
  test('archived + loading → archived', () => {
    expect(
      deriveKanbanStatus(
        chatInput({ archivedAt: new Date(), isLoading: true, latestActiveSubChat: { id: 's1', mode: 'execute' } })
      )
    ).toBe('archived');
  });

  test('archived + prUrl → archived', () => {
    expect(deriveKanbanStatus(chatInput({ archivedAt: new Date(), prUrl: 'https://example.com/pr/1' }))).toBe(
      'archived'
    );
  });

  // Done: prUrl wins over mode
  test('prUrl + loading → done', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          prUrl: 'https://example.com/pr/1',
          isLoading: true,
          latestActiveSubChat: { id: 's1', mode: 'execute' }
        })
      )
    ).toBe('done');
  });

  // Planning fallback when zero sub-chats
  test('zero sub-chats → planning', () => {
    expect(deriveKanbanStatus(chatInput({ latestActiveSubChat: null }))).toBe('planning');
  });

  test('plan sub-chat, never run → planning', () => {
    expect(deriveKanbanStatus(chatInput({ latestActiveSubChat: { id: 's1', mode: 'plan' }, isLoading: false }))).toBe(
      'planning'
    );
  });

  test('execute sub-chat, loading → in-progress', () => {
    expect(deriveKanbanStatus(chatInput({ latestActiveSubChat: { id: 's1', mode: 'execute' }, isLoading: true }))).toBe(
      'in-progress'
    );
  });

  test('explore sub-chat, loading → in-progress', () => {
    expect(deriveKanbanStatus(chatInput({ latestActiveSubChat: { id: 's1', mode: 'explore' }, isLoading: true }))).toBe(
      'in-progress'
    );
  });

  test('execute sub-chat, not loading → in-review', () => {
    expect(
      deriveKanbanStatus(chatInput({ latestActiveSubChat: { id: 's1', mode: 'execute' }, isLoading: false }))
    ).toBe('in-review');
  });

  // Regression: in-review and isLoading must be mutually exclusive
  test('regression: in-review never while isLoading=true', () => {
    const status = deriveKanbanStatus(
      chatInput({ latestActiveSubChat: { id: 's1', mode: 'execute' }, isLoading: true })
    );
    expect(status).not.toBe('in-review');
  });

  // Planning re-entry after In Review
  test('plan-mode sub-chat after prior In Review → planning', () => {
    // Caller already resolved latestActiveSubChat to the plan-mode one
    expect(deriveKanbanStatus(chatInput({ latestActiveSubChat: { id: 's2', mode: 'plan' }, isLoading: false }))).toBe(
      'planning'
    );
  });
});

// ── deriveAttentionReason ────────────────────────────────────────────────────

describe('deriveAttentionReason', () => {
  test('draft → null regardless of signals', () => {
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingQuestions: new Set(['chat-1']),
      workspacesWithPendingApprovals: new Set(['chat-1']),
      workspacesWithUnseenChanges: new Set(['chat-1'])
    };
    expect(deriveAttentionReason({ kind: 'draft', isVisible: true }, signals)).toBeNull();
  });

  test('archived → null regardless of signals', () => {
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingQuestions: new Set(['chat-1']),
      workspacesWithPendingApprovals: new Set(['chat-1']),
      workspacesWithUnseenChanges: new Set(['chat-1'])
    };
    expect(deriveAttentionReason(chatInput({ archivedAt: new Date() }), signals)).toBeNull();
  });

  test('no signals → null', () => {
    expect(deriveAttentionReason(chatInput({}), noSignals)).toBeNull();
  });

  test('pending-plan only → pending-plan', () => {
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingApprovals: new Set(['chat-1'])
    };
    expect(deriveAttentionReason(chatInput({}), signals)).toBe('pending-plan');
  });

  test('pending-question only → pending-question', () => {
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingQuestions: new Set(['chat-1'])
    };
    expect(deriveAttentionReason(chatInput({}), signals)).toBe('pending-question');
  });

  test('unseen-changes only → unseen-changes', () => {
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithUnseenChanges: new Set(['chat-1'])
    };
    expect(deriveAttentionReason(chatInput({}), signals)).toBe('unseen-changes');
  });

  // Precedence: pending-plan > pending-question
  test('pending-plan + pending-question → pending-plan', () => {
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingQuestions: new Set(['chat-1']),
      workspacesWithPendingApprovals: new Set(['chat-1']),
      workspacesWithUnseenChanges: new Set()
    };
    expect(deriveAttentionReason(chatInput({}), signals)).toBe('pending-plan');
  });

  // Precedence: pending-question > unseen-changes
  test('pending-question + unseen-changes → pending-question', () => {
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingQuestions: new Set(['chat-1']),
      workspacesWithPendingApprovals: new Set(),
      workspacesWithUnseenChanges: new Set(['chat-1'])
    };
    expect(deriveAttentionReason(chatInput({}), signals)).toBe('pending-question');
  });

  // Different chatId is unaffected
  test('signals for different chatId → null', () => {
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingQuestions: new Set(['chat-OTHER']),
      workspacesWithPendingApprovals: new Set(['chat-OTHER']),
      workspacesWithUnseenChanges: new Set(['chat-OTHER'])
    };
    expect(deriveAttentionReason(chatInput({ chatId: 'chat-1' }), signals)).toBeNull();
  });

  // ── Asymmetry rows ───────────────────────────────────────────────────────
  // State uses ONE representative sub-chat; attention unions across ALL sub-chats.
  // These rows fail loudly if attention is ever accidentally derived from latestActiveSubChat alone.

  test('asymmetry: latest execute clean but older plan sub-chat has pending-plan', () => {
    // State = in-review (latest is execute, not loading)
    // Attention = pending-plan (older sub-chat has pending approval)
    const input = chatInput({
      latestActiveSubChat: { id: 'exec-latest', mode: 'execute' },
      isLoading: false
    });
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingApprovals: new Set(['chat-1']), // any sub-chat of chat-1 has pending plan
      workspacesWithPendingQuestions: new Set(),
      workspacesWithUnseenChanges: new Set()
    };
    expect(deriveKanbanStatus(input)).toBe('in-review');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('asymmetry: latest execute clean, older execute has unanswered question', () => {
    const input = chatInput({
      latestActiveSubChat: { id: 'exec-latest', mode: 'execute' },
      isLoading: false
    });
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingApprovals: new Set(),
      workspacesWithPendingQuestions: new Set(['chat-1']),
      workspacesWithUnseenChanges: new Set()
    };
    expect(deriveKanbanStatus(input)).toBe('in-review');
    expect(deriveAttentionReason(input, signals)).toBe('pending-question');
  });
});

// ── Worked-example table (state + attention together) ───────────────────────

describe('worked examples', () => {
  test('1 plan sub-chat, never run → Planning, no attention', () => {
    const input = chatInput({ latestActiveSubChat: { id: 's1', mode: 'plan' }, isLoading: false });
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, noSignals)).toBeNull();
  });

  test('2 plan sub-chats, both pending approval → Planning, pending-plan', () => {
    // Caller pre-resolved to latest; both have pending approval (signals set contains chatId)
    const input = chatInput({ latestActiveSubChat: { id: 's2', mode: 'plan' }, isLoading: false });
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingApprovals: new Set(['chat-1'])
    };
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('plan pending approval + execute loading → In Progress, pending-plan', () => {
    // loading-wins picks the execute sub-chat; plan sub-chat still contributes to attention
    const input = chatInput({ latestActiveSubChat: { id: 'exec', mode: 'execute' }, isLoading: true });
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingApprovals: new Set(['chat-1'])
    };
    expect(deriveKanbanStatus(input)).toBe('in-progress');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('plan pending approval, no execute sub-chat → Planning, pending-plan', () => {
    const input = chatInput({ latestActiveSubChat: { id: 'plan', mode: 'plan' }, isLoading: false });
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingApprovals: new Set(['chat-1'])
    };
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('execute running + stale plan sub-chat → In Progress, no attention', () => {
    const input = chatInput({ latestActiveSubChat: { id: 'exec', mode: 'execute' }, isLoading: true });
    expect(deriveKanbanStatus(input)).toBe('in-progress');
    expect(deriveAttentionReason(input, noSignals)).toBeNull();
  });

  test('execute finished + stale plan sub-chat → In Review', () => {
    const input = chatInput({ latestActiveSubChat: { id: 'exec', mode: 'execute' }, isLoading: false });
    expect(deriveKanbanStatus(input)).toBe('in-review');
  });

  test('user opens new plan-mode sub-chat after In Review → Planning', () => {
    const input = chatInput({ latestActiveSubChat: { id: 'new-plan', mode: 'plan' }, isLoading: false });
    expect(deriveKanbanStatus(input)).toBe('planning');
  });
});
