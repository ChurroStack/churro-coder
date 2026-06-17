import { describe, expect, it } from 'vitest';
import { hasTaskNotification, parseTaskNotifications } from './task-notification';

// A trimmed-down but faithful sample of what the harness injects (entities
// escaped exactly as they arrive in storage).
const SAMPLE = `<task-notification>
<task-id>a6626bc9d0f54f1dc</task-id>
<tool-use-id>toolu_01BEC9frTyy71hkaH3CiJsYz</tool-use-id>
<status>completed</status>
<summary>Agent "Explore Project Settings &amp; schema" came to rest</summary>
<result>## Report\n\nUses \`x =&gt; y\` and a &lt;tag&gt;.</result>
<usage><subagent_tokens>64203</subagent_tokens><tool_uses>36</tool_uses><duration_ms>158522</duration_ms></usage>
</task-notification>`;

describe('parseTaskNotifications [chat/task-notification]', () => {
  it('returns a single text segment when there is no notification', () => {
    const { segments } = parseTaskNotifications('just a normal message');
    expect(segments).toEqual([{ type: 'text', text: 'just a normal message' }]);
  });

  it('parses a single notification with all fields', () => {
    const { segments } = parseTaskNotifications(SAMPLE);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('notification');
    const data = (segments[0] as Extract<(typeof segments)[number], { type: 'notification' }>).data;
    expect(data.taskId).toBe('a6626bc9d0f54f1dc');
    expect(data.agentName).toBe('Explore Project Settings & schema'); // entity-decoded
    expect(data.status).toBe('completed');
    expect(data.tokens).toBe(64203);
    expect(data.toolUses).toBe(36);
    expect(data.durationMs).toBe(158522);
  });

  it('decodes only the 5 named entities in the result body', () => {
    const { segments } = parseTaskNotifications(SAMPLE);
    const data = (segments[0] as Extract<(typeof segments)[number], { type: 'notification' }>).data;
    expect(data.result).toContain('x => y');
    expect(data.result).toContain('<tag>');
    expect(data.result).not.toContain('&gt;');
    expect(data.result).not.toContain('&lt;');
  });

  it('preserves interleaved plain text around a notification, in order', () => {
    const { segments } = parseTaskNotifications(`before\n${SAMPLE}\nafter`);
    expect(segments.map((s) => s.type)).toEqual(['text', 'notification', 'text']);
    expect((segments[0] as { text: string }).text).toContain('before');
    expect((segments[2] as { text: string }).text).toContain('after');
  });

  it('parses multiple consecutive notifications as separate segments', () => {
    const { segments } = parseTaskNotifications(`${SAMPLE}${SAMPLE}`);
    expect(segments.filter((s) => s.type === 'notification')).toHaveLength(2);
  });

  it('falls back to defaults when <usage> is missing', () => {
    const noUsage = `<task-notification><status>completed</status><summary>Agent "Foo" came to rest</summary><result>hi</result></task-notification>`;
    const { segments } = parseTaskNotifications(noUsage);
    const data = (segments[0] as Extract<(typeof segments)[number], { type: 'notification' }>).data;
    expect(data.tokens).toBeUndefined();
    expect(data.toolUses).toBeUndefined();
    expect(data.durationMs).toBeUndefined();
    expect(data.agentName).toBe('Foo');
  });

  it('treats an unterminated block as plain text (no half-parsed card)', () => {
    const partial = '<task-notification><status>completed</status><summary>Agent "Foo"';
    expect(hasTaskNotification(partial)).toBe(false);
    const { segments } = parseTaskNotifications(partial);
    expect(segments).toEqual([{ type: 'text', text: partial }]);
  });
});
