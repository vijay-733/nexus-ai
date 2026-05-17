import { globalEventBus } from '../events/eventBus.js';
import { metricsCollector } from '../observability/metrics.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { OpenAIProvider } from './providers/openaiProvider.js';
import { AnthropicProvider } from './providers/anthropicProvider.js';
import { PollinationsProvider } from './providers/pollinationsProvider.js';
import type { ModelProvider, ModelRequest, ModelResponse, ModelCapability } from './types.js';

const emit = globalEventBus.createEmitter('model-router');

export class ModelRouter {
  private providers: ModelProvider[] = [];
  private breakers  = new Map<string, CircuitBreaker>();

  constructor() {
    this.register(new OpenAIProvider());
    this.register(new AnthropicProvider());
    this.register(new PollinationsProvider());
  }

  register(provider: ModelProvider): void {
    this.providers.push(provider);
    this.providers.sort((a, b) => b.priority - a.priority);
    this.breakers.set(provider.name, new CircuitBreaker({ name: provider.name, failureThreshold: 3 }));
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const caps = request.capabilities ?? ['chat'];
    const eligible = this.providers.filter(p =>
      caps.every(c => p.capabilities.includes(c as ModelCapability))
    );

    let lastError: Error | null = null;
    for (const provider of eligible) {
      if (!(await provider.isAvailable())) continue;
      const breaker = this.breakers.get(provider.name)!;
      if (breaker.getState() === 'open') continue;

      const start = Date.now();
      try {
        const response = await breaker.execute(() => provider.complete(request));
        const latencyMs = Date.now() - start;
        metricsCollector.recordModelCall(provider.name, response.totalTokens ?? 0, latencyMs, false);
        emit('MODEL_ROUTED', { provider: provider.name, model: response.model, latencyMs, tokens: response.totalTokens });
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        metricsCollector.recordModelCall(provider.name, 0, Date.now() - start, true);
        emit('MODEL_FALLBACK', { from: provider.name, error: lastError.message });
      }
    }

    emit('MODEL_FAILED', { error: lastError?.message ?? 'All providers failed' });
    throw lastError ?? new Error('All model providers failed');
  }

  getProviderStatus(): Array<{
    name: string; priority: number; circuit: ReturnType<CircuitBreaker['stats']>;
  }> {
    return this.providers.map(p => ({
      name:     p.name,
      priority: p.priority,
      circuit:  this.breakers.get(p.name)!.stats(),
    }));
  }
}

export const modelRouter = new ModelRouter();
