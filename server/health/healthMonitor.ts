import { globalEventBus } from '../events/eventBus.js';
import { alertSystem } from './alertSystem.js';

export type HealthStatus = 'healthy' | 'degraded' | 'critical';

export interface HealthCheck {
  status: HealthStatus;
  value: number;
  threshold: number;
  criticalThreshold: number;
  message: string;
}

export interface HealthReport {
  status: HealthStatus;
  checks: Record<string, HealthCheck>;
  since: number;
  checkedAt: number;
}

interface LatencySample { ts: number; ms: number; }
interface TokenSample   { ts: number; count: number; }

const WINDOW_MS            = 5 * 60_000;  // 5-minute sliding window
const CHECK_INTERVAL_MS    = 30_000;      // run checks every 30s

export class HealthMonitor {
  private windows = {
    agentFailures:  [] as number[],
    taskFailures:   [] as number[],
    toolTimeouts:   [] as number[],
    modelFailures:  [] as number[],
    latencies:      [] as LatencySample[],
    tokens:         [] as TokenSample[],
  };

  private baselineTokensPerMin = 0;
  private startedAt            = Date.now();
  private lastStatus: HealthStatus = 'healthy';
  private checkTimer: ReturnType<typeof setInterval>;
  private unsubs: Array<() => void> = [];

  constructor() {
    this.wireEvents();
    this.checkTimer = setInterval(() => this.runChecks(), CHECK_INTERVAL_MS);
    this.checkTimer.unref?.();
  }

  private wireEvents(): void {
    this.unsubs.push(
      globalEventBus.on('AGENT_FAILED',  () => { this.windows.agentFailures.push(Date.now()); }),
      globalEventBus.on('TASK_FAILED',   () => { this.windows.taskFailures.push(Date.now()); }),
      globalEventBus.on('TOOL_TIMEOUT',  () => { this.windows.toolTimeouts.push(Date.now()); }),
      globalEventBus.on('MODEL_FAILED',  () => { this.windows.modelFailures.push(Date.now()); }),
      globalEventBus.on('MODEL_ROUTED',  e => {
        const p  = e.payload as Record<string, unknown>;
        const ms = Number(p.latencyMs ?? 0);
        const tk = Number(p.tokens    ?? 0);
        const ts = Date.now();
        this.windows.latencies.push({ ts, ms });
        this.windows.tokens.push({ ts, count: tk });
      }),
    );
  }

  private prune(): void {
    const cutoff = Date.now() - WINDOW_MS;
    this.windows.agentFailures = this.windows.agentFailures.filter(t => t > cutoff);
    this.windows.taskFailures  = this.windows.taskFailures.filter(t  => t > cutoff);
    this.windows.toolTimeouts  = this.windows.toolTimeouts.filter(t  => t > cutoff);
    this.windows.modelFailures = this.windows.modelFailures.filter(t => t > cutoff);
    this.windows.latencies     = this.windows.latencies.filter(s    => s.ts > cutoff);
    this.windows.tokens        = this.windows.tokens.filter(s       => s.ts > cutoff);
  }

  private p95(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!;
  }

  private runChecks(): void {
    const report = this.getReport();
    if (report.status !== this.lastStatus) {
      globalEventBus.createEmitter('health-monitor')('HEALTH_ALERT', {
        previousStatus: this.lastStatus,
        currentStatus:  report.status,
        checks:         report.checks,
      });
      void alertSystem.notify(report);
      this.lastStatus = report.status;
    }
  }

  getReport(): HealthReport {
    this.prune();
    const windowMin = WINDOW_MS / 60_000;
    const checks: Record<string, HealthCheck> = {};
    let worst: HealthStatus = 'healthy';

    const add = (
      name: string,
      value: number,
      threshold: number,
      criticalThreshold: number,
      unit: string
    ): void => {
      const status: HealthStatus =
        value >= criticalThreshold ? 'critical' :
        value >= threshold         ? 'degraded' :
        'healthy';
      checks[name] = {
        status, value, threshold, criticalThreshold,
        message: `${value.toFixed(2)} ${unit} (warn≥${threshold}, crit≥${criticalThreshold})`,
      };
      if (status === 'critical') worst = 'critical';
      else if (status === 'degraded' && worst === 'healthy') worst = 'degraded';
    };

    add('agentFailureRate', this.windows.agentFailures.length / windowMin,  5, 15, 'failures/min');
    add('taskFailureRate',  this.windows.taskFailures.length  / windowMin,  5, 15, 'failures/min');
    add('toolTimeoutRate',  this.windows.toolTimeouts.length  / windowMin,  3, 10, 'timeouts/min');
    add('modelFailureRate', this.windows.modelFailures.length / windowMin,  2,  8, 'failures/min');

    const p95ms = this.p95(this.windows.latencies.map(s => s.ms));
    add('p95LatencyMs', p95ms, 15_000, 30_000, 'ms');

    const totalTokens    = this.windows.tokens.reduce((s, t) => s + t.count, 0);
    const tokensPerMin   = totalTokens / windowMin;
    if (this.baselineTokensPerMin === 0 && tokensPerMin > 0) {
      this.baselineTokensPerMin = tokensPerMin;
    }
    const spikeRatio = this.baselineTokensPerMin > 0 ? tokensPerMin / this.baselineTokensPerMin : 1;
    add('tokenSpike', spikeRatio, 2, 4, 'x baseline');

    return { status: worst, checks, since: this.startedAt, checkedAt: Date.now() };
  }

  updateThresholds(_patch: Record<string, unknown>): void {
    // Thresholds are inline constants; this hook exists for future runtime config
  }

  destroy(): void {
    clearInterval(this.checkTimer);
    this.unsubs.forEach(fn => fn());
  }
}

export const healthMonitor = new HealthMonitor();
