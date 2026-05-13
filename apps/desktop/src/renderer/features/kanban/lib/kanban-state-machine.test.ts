import { describe, test, expect } from 'vitest';
import {
  deriveKanbanStatus,
  deriveAttentionReason,
  type KanbanInput,
  type KanbanAttentionSignals,
  type SubChatMode
} from './kanban-state-machine';

const noSignals: KanbanAttentionSignals = {
  workspacesWithPendingQuestions: new Set(),
  workspacesWithPendingApprovals: new Set(),
  workspacesWithUnseenChanges: new Set()
};

function chatInput(partial: {
  chatId?: string;
  archivedAt?: Date | null;
  prUrl?: string | null;
  subChats?: Array<{ id: string; mode: SubChatMode }>;
  loadingSubChatIds?: Set<string>;
}): Extract<KanbanInput, { kind: 'chat' }> {
  return {
    kind: 'chat',
    chatId: partial.chatId ?? 'chat-1',
    archivedAt: partial.archivedAt ?? null,
    prUrl: partial.prUrl ?? null,
    subChats: partial.subChats ?? [],
    loadingSubChatIds: partial.loadingSubChatIds ?? new Set()
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
        chatInput({
          archivedAt: new Date(),
          subChats: [{ id: 's1', mode: 'execute' }],
          loadingSubChatIds: new Set(['s1'])
        })
      )
    ).toBe('archived');
  });

  test('archived + prUrl → archived', () => {
    expect(deriveKanbanStatus(chatInput({ archivedAt: new Date(), prUrl: 'https://example.com/pr/1' }))).toBe(
      'archived'
    );
  });

  // Done: prUrl wins when no plan sub-chats
  test('prUrl + execute loading → done', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          prUrl: 'https://example.com/pr/1',
          subChats: [{ id: 's1', mode: 'execute' }],
          loadingSubChatIds: new Set(['s1'])
        })
      )
    ).toBe('done');
  });

  // Planning fallback when zero sub-chats
  test('zero sub-chats → planning', () => {
    expect(deriveKanbanStatus(chatInput({ subChats: [] }))).toBe('planning');
  });

  test('plan sub-chat, never run → planning', () => {
    expect(deriveKanbanStatus(chatInput({ subChats: [{ id: 's1', mode: 'plan' }] }))).toBe('planning');
  });

  test('execute sub-chat, loading → in-progress', () => {
    expect(
      deriveKanbanStatus(chatInput({ subChats: [{ id: 's1', mode: 'execute' }], loadingSubChatIds: new Set(['s1']) }))
    ).toBe('in-progress');
  });

  test('explore sub-chat, loading → in-progress', () => {
    expect(
      deriveKanbanStatus(chatInput({ subChats: [{ id: 's1', mode: 'explore' }], loadingSubChatIds: new Set(['s1']) }))
    ).toBe('in-progress');
  });

  test('execute sub-chat, not loading → in-review', () => {
    expect(deriveKanbanStatus(chatInput({ subChats: [{ id: 's1', mode: 'execute' }] }))).toBe('in-review');
  });

  // Regression: in-review and loading must be mutually exclusive
  test('regression: in-review never while a sub-chat is loading', () => {
    const status = deriveKanbanStatus(
      chatInput({ subChats: [{ id: 's1', mode: 'execute' }], loadingSubChatIds: new Set(['s1']) })
    );
    expect(status).not.toBe('in-review');
  });

  // Planning re-entry after In Review
  test('plan-mode sub-chat after prior In Review → planning', () => {
    expect(deriveKanbanStatus(chatInput({ subChats: [{ id: 's2', mode: 'plan' }] }))).toBe('planning');
  });

  // ── Aggregation cases ──────────────────────────────────────────────────────

  test('done execute + plan sub-chat → planning (plan beats everything except archived)', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          subChats: [
            { id: 'exec-1', mode: 'execute' },
            { id: 'plan-1', mode: 'plan' }
          ]
        })
      )
    ).toBe('planning');
  });

  test('done execute + plan sub-chat, plan is loading → planning (plan still wins)', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          subChats: [
            { id: 'exec-1', mode: 'execute' },
            { id: 'plan-1', mode: 'plan' }
          ],
          loadingSubChatIds: new Set(['plan-1'])
        })
      )
    ).toBe('planning');
  });

  test('execute loading + execute settled → in-progress', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          subChats: [
            { id: 'exec-1', mode: 'execute' },
            { id: 'exec-2', mode: 'execute' }
          ],
          loadingSubChatIds: new Set(['exec-1'])
        })
      )
    ).toBe('in-progress');
  });

  test('execute settled + explore settled, no plan → in-review', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          subChats: [
            { id: 'exec-1', mode: 'execute' },
            { id: 'explore-1', mode: 'explore' }
          ]
        })
      )
    ).toBe('in-review');
  });

  test('prUrl + plan sub-chat → planning (plan beats prUrl)', () => {
    expect(
      deriveKanbanStatus(chatInput({ prUrl: 'https://example.com/pr/1', subChats: [{ id: 'plan-1', mode: 'plan' }] }))
    ).toBe('planning');
  });

  test('prUrl + only execute settled → done', () => {
    expect(
      deriveKanbanStatus(
        chatInput({ prUrl: 'https://example.com/pr/1', subChats: [{ id: 'exec-1', mode: 'execute' }] })
      )
    ).toBe('done');
  });

  test('archived + plan sub-chat → archived', () => {
    expect(deriveKanbanStatus(chatInput({ archivedAt: new Date(), subChats: [{ id: 'plan-1', mode: 'plan' }] }))).toBe(
      'archived'
    );
  });

  test('mix of plan + explore, none loading → planning', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          subChats: [
            { id: 'plan-1', mode: 'plan' },
            { id: 'explore-1', mode: 'explore' }
          ]
        })
      )
    ).toBe('planning');
  });

  // Auto-promote regression: tab promotion moves exec to index 0 and adds it to loadingSubChatIds,
  // but the presence of a plan sub-chat must keep the workspace in Planning.
  test('auto-promote regression: plan + exec, exec not loading → planning', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          subChats: [
            { id: 'plan-1', mode: 'plan' },
            { id: 'exec-1', mode: 'execute' }
          ],
          loadingSubChatIds: new Set()
        })
      )
    ).toBe('planning');
  });

  test('auto-promote regression: plan + exec, exec loading → planning (plan still wins)', () => {
    expect(
      deriveKanbanStatus(
        chatInput({
          subChats: [
            { id: 'plan-1', mode: 'plan' },
            { id: 'exec-1', mode: 'execute' }
          ],
          loadingSubChatIds: new Set(['exec-1'])
        })
      )
    ).toBe('planning');
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
  // Kanban status comes from aggregating all sub-chats; attention unions across ALL sub-chats.
  // These rows fail loudly if attention is ever accidentally derived from sub-chat state alone.

  test('asymmetry: only execute sub-chat clean, pending-plan signal still fires', () => {
    // State = in-review (only execute sub-chat, not loading)
    // Attention = pending-plan (workspace-level signal from another sub-chat or DB record)
    const input = chatInput({
      subChats: [{ id: 'exec-latest', mode: 'execute' }]
    });
    const signals: KanbanAttentionSignals = {
      workspacesWithPendingApprovals: new Set(['chat-1']),
      workspacesWithPendingQuestions: new Set(),
      workspacesWithUnseenChanges: new Set()
    };
    expect(deriveKanbanStatus(input)).toBe('in-review');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('asymmetry: only execute sub-chat clean, pending-question signal still fires', () => {
    const input = chatInput({
      subChats: [{ id: 'exec-latest', mode: 'execute' }]
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
    const input = chatInput({ subChats: [{ id: 's1', mode: 'plan' }] });
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, noSignals)).toBeNull();
  });

  test('2 plan sub-chats, both pending approval → Planning, pending-plan', () => {
    const input = chatInput({
      subChats: [
        { id: 's1', mode: 'plan' },
        { id: 's2', mode: 'plan' }
      ]
    });
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingApprovals: new Set(['chat-1'])
    };
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('plan pending approval + execute loading → Planning, pending-plan', () => {
    // Both plan and execute sub-chats exist. Plan wins; execute loading is irrelevant.
    const input = chatInput({
      subChats: [
        { id: 'plan-1', mode: 'plan' },
        { id: 'exec', mode: 'execute' }
      ],
      loadingSubChatIds: new Set(['exec'])
    });
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingApprovals: new Set(['chat-1'])
    };
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('plan pending approval, no execute sub-chat → Planning, pending-plan', () => {
    const input = chatInput({ subChats: [{ id: 'plan', mode: 'plan' }] });
    const signals: KanbanAttentionSignals = {
      ...noSignals,
      workspacesWithPendingApprovals: new Set(['chat-1'])
    };
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, signals)).toBe('pending-plan');
  });

  test('execute running + plan sub-chat → Planning, no attention (plan wins over loading)', () => {
    // Previously returned In Progress; plan sub-chat pulls it back to Planning.
    const input = chatInput({
      subChats: [
        { id: 'stale-plan', mode: 'plan' },
        { id: 'exec', mode: 'execute' }
      ],
      loadingSubChatIds: new Set(['exec'])
    });
    expect(deriveKanbanStatus(input)).toBe('planning');
    expect(deriveAttentionReason(input, noSignals)).toBeNull();
  });

  test('execute finished, no plan sub-chat → In Review', () => {
    const input = chatInput({ subChats: [{ id: 'exec', mode: 'execute' }] });
    expect(deriveKanbanStatus(input)).toBe('in-review');
  });

  test('user opens new plan-mode sub-chat after In Review → Planning', () => {
    const input = chatInput({
      subChats: [
        { id: 'exec', mode: 'execute' },
        { id: 'new-plan', mode: 'plan' }
      ]
    });
    expect(deriveKanbanStatus(input)).toBe('planning');
  });
});
