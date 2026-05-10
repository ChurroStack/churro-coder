import { describe, expect, it } from 'vitest';
import { createTransformer } from './transform';
import type { MessageMetadata, UIMessageChunk } from './types';

function collectChunks(transformer: ReturnType<typeof createTransformer>, message: unknown): UIMessageChunk[] {
  return Array.from(transformer(message as never));
}

function readMetadata(chunks: UIMessageChunk[]): MessageMetadata | undefined {
  return chunks.find((chunk): chunk is Extract<UIMessageChunk, { type: 'message-metadata' }> => chunk.type === 'message-metadata')
    ?.messageMetadata;
}

describe('createTransformer', () => {
  it('stamps Claude modelContextWindow from the requested catalog model', () => {
    const transformer = createTransformer({ requestedModel: 'opus[1m]' });

    collectChunks(transformer, {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        model: 'claude-opus-4-7',
        usage: {
          input_tokens: 514_200,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 2_100
        }
      }
    });

    const metadata = readMetadata(
      collectChunks(transformer, {
        type: 'result',
        subtype: 'success',
        session_id: 'sess-1',
        total_cost_usd: 1.23,
        usage: {
          input_tokens: 514_200,
          output_tokens: 2_100
        }
      })
    );

    expect(metadata?.model).toBe('claude-opus-4-7');
    expect(metadata?.modelContextWindow).toBe(1_000_000);
    expect(metadata?.inputTokens).toBe(514_200);
  });

  it('leaves modelContextWindow undefined for unknown requested models', () => {
    const transformer = createTransformer({ requestedModel: 'claude-opus-4-7' });

    collectChunks(transformer, {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        model: 'claude-opus-4-7',
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      }
    });

    const metadata = readMetadata(
      collectChunks(transformer, {
        type: 'result',
        subtype: 'success',
        session_id: 'sess-2',
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      })
    );

    expect(metadata?.modelContextWindow).toBeUndefined();
  });
});
