import { describe, expect, it } from 'vitest';
import { computeCloseDisableState } from './anchor-panels';

// Invariant [workspace-project-settings/§4]: a workspace must keep at least one
// anchor open — a chat, an OpenSpec editor, OR the Project Settings panel.
describe('computeCloseDisableState — Project Settings as an anchor', () => {
  it('disables close on a Project Settings panel that is the sole anchor', () => {
    // Local workspace: just the PS panel, 0 chats.
    const state = computeCloseDisableState('project-settings:ws-1', 1, 1);
    expect(state.isAnchorPanel).toBe(true);
    expect(state.isLastAnchor).toBe(true);
    expect(state.closeDisabled).toBe(true);
  });

  it('enables closing the Project Settings panel once a chat tab is also open', () => {
    // PS panel + one chat tab → 2 anchors, 2 panels.
    const state = computeCloseDisableState('project-settings:ws-1', 2, 2);
    expect(state.isAnchorPanel).toBe(true);
    expect(state.isLastAnchor).toBe(false);
    expect(state.isOnlyPanel).toBe(false);
    expect(state.closeDisabled).toBe(false);
  });

  it('treats chat and openspec-change panels as anchors too', () => {
    expect(computeCloseDisableState('chat:sc-1', 1, 1).closeDisabled).toBe(true);
    expect(computeCloseDisableState('openspec-change:ch-1', 1, 1).closeDisabled).toBe(true);
  });

  it('still disables close on the only tab even when it is not an anchor', () => {
    const state = computeCloseDisableState('terminal:pane-1', 0, 1);
    expect(state.isAnchorPanel).toBe(false);
    expect(state.isOnlyPanel).toBe(true);
    expect(state.closeDisabled).toBe(true);
  });

  it('allows closing a non-anchor tab when other tabs remain', () => {
    const state = computeCloseDisableState('terminal:pane-1', 1, 3);
    expect(state.closeDisabled).toBe(false);
  });
});
