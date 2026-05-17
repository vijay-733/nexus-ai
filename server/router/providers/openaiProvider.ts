import type { ModelProvider, ModelRequest, ModelResponse, ModelCapability } from '../types.js';

export class OpenAIProvider implements ModelProvider {
  name = 'openai';
  priority = 90;
  capabilities: ModelCapability[] = ['chat', 'completion', 'vision', 'image'];

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY not configured');

    const model = request.model ?? 'gpt-4o-mini';
    const start = Date.now();

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages:    request.messages,
        max_tokens:  request.maxTokens  ?? 2048,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `OpenAI error ${res.status}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage:   { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model:   string;
    };

    return {
      content:      data.choices[0].message.content,
      model:        data.model,
      provider:     'openai',
      inputTokens:  data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens:  data.usage.total_tokens,
      latencyMs:    Date.now() - start,
      finishReason: data.choices[0].finish_reason,
    };
  }
}
