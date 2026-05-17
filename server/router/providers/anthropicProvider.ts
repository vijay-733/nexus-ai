import type { ModelProvider, ModelRequest, ModelResponse, ModelCapability } from '../types.js';

export class AnthropicProvider implements ModelProvider {
  name = 'anthropic';
  priority = 80;
  capabilities: ModelCapability[] = ['chat', 'completion', 'vision'];

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

    const model = request.model ?? 'claude-haiku-4-5-20251001';
    const start = Date.now();

    const systemMsg = request.messages.find(m => m.role === 'system');
    const messages  = request.messages.filter(m => m.role !== 'system');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? 2048,
        system:     systemMsg?.content,
        messages:   messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `Anthropic error ${res.status}`);
    }

    const data = await res.json() as {
      content:     Array<{ text: string }>;
      model:       string;
      stop_reason: string;
      usage:       { input_tokens: number; output_tokens: number };
    };

    return {
      content:      data.content[0]?.text ?? '',
      model:        data.model,
      provider:     'anthropic',
      inputTokens:  data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens:  data.usage.input_tokens + data.usage.output_tokens,
      latencyMs:    Date.now() - start,
      finishReason: data.stop_reason,
    };
  }
}
