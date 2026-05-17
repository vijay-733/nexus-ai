import { globalEventBus } from '../events/eventBus.js';

export interface ModelMetrics {
  provider: string;
  requests: number;
  failures: number;
  totalTokens: number;
  totalLatencyMs: number;
}

export interface ToolMetrics {
  name: string;
  calls: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
}

export interface MetricsReport {
  uptime: number;
  startedAt: number;
  agents:     { started: number; completed: number; failed: number };
  tasks:      { created: number; completed: number; failed: number };
  models:     Record<string, ModelMetrics>;
  tools:      Record<string, ToolMetrics>;
  events:     { total: number; perType: Record<string, number> };
  memory:     { reads: number; writes: number; deletes: number };
  governance: { checks: number; denials: number };
}

export class MetricsCollector {
  private startedAt    = Date.now();
  private counts: Record<string, number>         = {};
  private modelMetrics: Record<string, ModelMetrics> = {};
  private toolMetrics:  Record<string, ToolMetrics>  = {};
  private unsubscribe:  Array<() => void>        = [];

  constructor() { this.wireEventBus(); }

  private inc(key: string, by = 1): void {
    this.counts[key] = (this.counts[key] ?? 0) + by;
  }

  recordModelCall(provider: string, tokens: number, latencyMs: number, failed = false): void {
    if (!this.modelMetrics[provider]) {
      this.modelMetrics[provider] = { provider, requests: 0, failures: 0, totalTokens: 0, totalLatencyMs: 0 };
    }
    const m = this.modelMetrics[provider];
    m.requests++;
    m.totalTokens    += tokens;
    m.totalLatencyMs += latencyMs;
    if (failed) m.failures++;
  }

  recordToolCall(name: string, latencyMs: number, success: boolean): void {
    if (!this.toolMetrics[name]) {
      this.toolMetrics[name] = { name, calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 };
    }
    const t = this.toolMetrics[name];
    t.calls++;
    t.totalLatencyMs += latencyMs;
    if (success) t.successes++; else t.failures++;
  }

  getReport(): MetricsReport {
    const eb = globalEventBus.stats();
    return {
      uptime:    Date.now() - this.startedAt,
      startedAt: this.startedAt,
      agents: {
        started:   this.counts['agent.started']   ?? 0,
        completed: this.counts['agent.completed'] ?? 0,
        failed:    this.counts['agent.failed']    ?? 0,
      },
      tasks: {
        created:   this.counts['task.created']   ?? 0,
        completed: this.counts['task.completed'] ?? 0,
        failed:    this.counts['task.failed']    ?? 0,
      },
      models:     this.modelMetrics,
      tools:      this.toolMetrics,
      events:     { total: eb.total, perType: eb.counts as Record<string, number> },
      memory: {
        reads:   this.counts['memory.read']    ?? 0,
        writes:  this.counts['memory.written'] ?? 0,
        deletes: this.counts['memory.deleted'] ?? 0,
      },
      governance: {
        checks:  this.counts['governance.checked'] ?? 0,
        denials: this.counts['governance.denied']  ?? 0,
      },
    };
  }

  private wireEventBus(): void {
    this.unsubscribe.push(
      globalEventBus.on('AGENT_STARTED',      () => this.inc('agent.started')),
      globalEventBus.on('AGENT_COMPLETED',    () => this.inc('agent.completed')),
      globalEventBus.on('AGENT_FAILED',       () => this.inc('agent.failed')),
      globalEventBus.on('TASK_CREATED',       () => this.inc('task.created')),
      globalEventBus.on('TASK_COMPLETED',     () => this.inc('task.completed')),
      globalEventBus.on('TASK_FAILED',        () => this.inc('task.failed')),
      globalEventBus.on('MEMORY_READ',        () => this.inc('memory.read')),
      globalEventBus.on('MEMORY_WRITTEN',     () => this.inc('memory.written')),
      globalEventBus.on('MEMORY_DELETED',     () => this.inc('memory.deleted')),
      globalEventBus.on('GOVERNANCE_CHECKED', () => this.inc('governance.checked')),
      globalEventBus.on('GOVERNANCE_DENIED',  () => this.inc('governance.denied')),
      globalEventBus.on('MODEL_ROUTED', e => {
        const p = e.payload as Record<string, unknown>;
        this.recordModelCall(String(p.provider ?? 'unknown'), Number(p.tokens ?? 0), Number(p.latencyMs ?? 0), false);
      }),
      globalEventBus.on('MODEL_FAILED', e => {
        const p = e.payload as Record<string, unknown>;
        this.recordModelCall(String(p.provider ?? 'unknown'), 0, 0, true);
      }),
    );
  }

  destroy(): void { this.unsubscribe.forEach(fn => fn()); }
}

export const metricsCollector = new MetricsCollector();
