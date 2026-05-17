import type { ModelProvider, ModelRequest, ModelResponse, ModelCapability } from '../types.js';

const MODELS = ['openai', 'mistral', 'llama', 'deepseek', 'qwen-coder'];
let modelIndex = 0;

export class PollinationsProvider implements ModelProvider {
  name = 'pollinations';
  priority = 10;
  capabilities: ModelCapability[] = ['chat', 'completion'];

  async isAvailable(): Promise<boolean> { return true; }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model ?? MODELS[modelIndex++ % MODELS.length];
    const start = Date.now();

    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages:    request.messages,
        max_tokens:  request.maxTokens  ?? 1024,
        temperature: request.temperature ?? 0.7,
        seed:        Math.floor(Math.random() * 999_999),
      }),
    });

    if (!res.ok) throw new Error(`Pollinations error ${res.status}`);

    const data = await res.json() as {
      choices: Array<{ message: { content: string }; finish_reason?: string }>;
      usage?:  { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    return {
      content:      data.choices[0].message.content,
      model,
      provider:     'pollinations',
      inputTokens:  data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      totalTokens:  data.usage?.total_tokens,
      latencyMs:    Date.now() - start,
      finishReason: data.choices[0].finish_reason,
    };
  }
}
