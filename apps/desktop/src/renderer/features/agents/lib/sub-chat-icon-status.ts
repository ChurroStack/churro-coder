export type SubChatIconKind = 'error' | 'busy' | 'needs-input' | 'idle';

export interface SubChatIconInputs {
  hasError: boolean;
  isBusy: boolean;
  needsInput: boolean;
}

// Priority: error > busy > needs-input > idle. Busy beats needs-input so the
// dock tab and sidebar rows surface the spinner while the agent is actively
// producing output — a stale pending/expired question shouldn't pin the hand
// over a working agent.
export function deriveSubChatIconKind(i: SubChatIconInputs): SubChatIconKind {
  if (i.hasError) return 'error';
  if (i.isBusy) return 'busy';
  if (i.needsInput) return 'needs-input';
  return 'idle';
}
