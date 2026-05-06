export type ChatEvent = {
  ts: number;
  phase: 'dispatch' | 'start' | 'end' | 'error' | 'abort' | 'session-resolved';
  sub: string;
  workspace_id: string;
  mode: string;
  session_id?: string;
  stream_id?: string;
  note?: string;
};

const CAP = 50;
const buf: ChatEvent[] = [];

export function recordChatEvent(event: ChatEvent): void {
  buf.push(event);
  if (buf.length > CAP) {
    buf.shift();
  }
}

export function snapshotChatEvents(): ChatEvent[] {
  return buf.slice();
}
