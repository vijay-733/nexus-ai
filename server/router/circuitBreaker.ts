export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  successThreshold?: number;
  halfOpenTimeout?: number;
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly halfOpenTimeout: number;
  readonly name: string;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.successThreshold = config.successThreshold ?? 2;
    this.halfOpenTimeout  = config.halfOpenTimeout  ?? 30_000;
    this.name             = config.name ?? 'circuit';
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime < this.halfOpenTimeout) {
        throw new Error(`Circuit "${this.name}" is OPEN`);
      }
      this.state = 'half-open';
      this.successCount = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) this.state = 'closed';
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) this.state = 'open';
  }

  getState(): CircuitState { return this.state; }
  reset(): void { this.state = 'closed'; this.failureCount = 0; this.successCount = 0; }
  stats() { return { state: this.state, failureCount: this.failureCount, successCount: this.successCount }; }
}
