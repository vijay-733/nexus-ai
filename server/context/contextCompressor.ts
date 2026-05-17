import { modelRouter } from '../router/modelRouter.js';
import type { ModelMessage } from '../router/types.js';

export interface CompressionResult {
  messages:         ModelMessage[];
  originalChars:    number;
  compressedChars:  number;
  compressionRatio: number;
  summarized:       boolean;
}

const DEFAULT_MAX_CHARS = 16_000;

export class ContextCompressor {
  async compress(
    messages: ModelMessage[],
    maxChars = DEFAULT_MAX_CHARS
  ): Promise<CompressionResult> {
    const originalChars = messages.reduce((s, m) => s + m.content.length, 0);

    if (originalChars <= maxChars) {
      return { messages, originalChars, compressedChars: originalChars, compressionRatio: 1, summarized: false };
    }

    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystem  = messages.filter(m => m.role !== 'system');
    const tail       = nonSystem.slice(-4);  // always keep last 4 turns verbatim
    const middle     = nonSystem.slice(0, -4);

    if (!middle.length) {
      return { messages, originalChars, compressedChars: originalChars, compressionRatio: 1, summarized: false };
    }

    const conversationText = middle
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    let summary: string;
    try {
      const res = await modelRouter.complete({
        messages: [
          {
            role:    'system',
            content: 'Compress this conversation into a dense summary (max 300 words). Preserve key decisions, facts, tool results, and user intent. No preamble.',
          },
          { role: 'user', content: conversationText },
        ],
        maxTokens:   400,
        temperature: 0,
      });
      summary = `[Compressed Context — ${middle.length} turns]\n${res.content}`;
    } catch {
      summary = `[Compressed Context — ${middle.length} prior exchanges omitted to fit token budget]`;
    }

    const compressed: ModelMessage[] = [
      ...systemMsgs,
      { role: 'system', content: summary },
      ...tail,
    ];
    const compressedChars = compressed.reduce((s, m) => s + m.content.length, 0);

    return {
      messages:         compressed,
      originalChars,
      compressedChars,
      compressionRatio: compressedChars / originalChars,
      summarized:       true,
    };
  }

  estimateTokens(messages: ModelMessage[]): number {
    return Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
  }
}

export const contextCompressor = new ContextCompressor();
