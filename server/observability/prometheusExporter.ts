// Prometheus-compatible text-format metrics exporter.
// Exposes counter, gauge, and histogram types without requiring a heavy client lib.
// Format follows Prometheus exposition format v0.0.4.

import { metricsCollector } from './metrics.js';
import { globalEventBus }   from '../events/eventBus.js';

type MetricType = 'counter' | 'gauge' | 'histogram';

interface Metric {
  name:   string;
  help:   string;
  type:   MetricType;
  labels: Record<string, string>;
  value:  number;
}

interface HistogramBucket {
  le:    string;
  count: number;
}

// ── In-process histogram store ────────────────────────────────────────────────
const latencyBuckets: Record<string, number[]> = {};

function recordLatency(name: string, ms: number): void {
  if (!latencyBuckets[name]) latencyBuckets[name] = [];
  latencyBuckets[name].push(ms);
  if (latencyBuckets[name].length > 10_000) latencyBuckets[name].shift();
}

function histogramBuckets(name: string): HistogramBucket[] {
  const values   = latencyBuckets[name] ?? [];
  const thresholds = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  return thresholds.map(le => ({
    le:    String(le),
    count: values.filter(v => v <= le).length,
  }));
}

// ── Wire event bus to capture latencies ──────────────────────────────────────
globalEventBus.on('MODEL_ROUTED', (e) => {
  const p = e.payload as Record<string, unknown>;
  if (typeof p['latencyMs'] === 'number') {
    recordLatency(`model_${String(p['provider'] ?? 'unknown')}`, p['latencyMs'] as number);
  }
});

// ── Prometheus text format serialiser ─────────────────────────────────────────
function labelStr(labels: Record<string, string>): string {
  const pairs = Object.entries(labels).map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`);
  return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
}

function formatMetric(m: Metric): string {
  return `${m.name}${labelStr(m.labels)} ${m.value}`;
}

// ── Main export function ──────────────────────────────────────────────────────
export function exportPrometheusMetrics(): string {
  const report  = metricsCollector.getReport();
  const lines:  string[] = [];
  const now     = Date.now();

  function write(name: string, help: string, type: MetricType, metrics: Metric[]): void {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const m of metrics) lines.push(formatMetric(m));
  }

  // ── Uptime ────────────────────────────────────────────────────────────────
  write('nexus_uptime_seconds', 'Server uptime in seconds', 'gauge', [{
    name: 'nexus_uptime_seconds', help: '', type: 'gauge', labels: {}, value: report.uptime / 1_000,
  }]);

  // ── Agent metrics ─────────────────────────────────────────────────────────
  write('nexus_agents_total', 'Total agent executions by status', 'counter', [
    { name: 'nexus_agents_total', help: '', type: 'counter', labels: { status: 'started'   }, value: report.agents.started    },
    { name: 'nexus_agents_total', help: '', type: 'counter', labels: { status: 'completed' }, value: report.agents.completed  },
    { name: 'nexus_agents_total', help: '', type: 'counter', labels: { status: 'failed'    }, value: report.agents.failed     },
  ]);

  // ── Task metrics ──────────────────────────────────────────────────────────
  write('nexus_tasks_total', 'Total task executions by status', 'counter', [
    { name: 'nexus_tasks_total', help: '', type: 'counter', labels: { status: 'created'   }, value: report.tasks.created   },
    { name: 'nexus_tasks_total', help: '', type: 'counter', labels: { status: 'completed' }, value: report.tasks.completed },
    { name: 'nexus_tasks_total', help: '', type: 'counter', labels: { status: 'failed'    }, value: report.tasks.failed    },
  ]);

  // ── Model metrics ─────────────────────────────────────────────────────────
  for (const [provider, m] of Object.entries(report.models)) {
    write(`nexus_model_requests_total`, 'Total model requests', 'counter', [
      { name: 'nexus_model_requests_total', help: '', type: 'counter',
        labels: { provider }, value: m.requests },
    ]);
    write(`nexus_model_failures_total`, 'Total model failures', 'counter', [
      { name: 'nexus_model_failures_total', help: '', type: 'counter',
        labels: { provider }, value: m.failures },
    ]);
    write(`nexus_model_tokens_total`, 'Total model tokens used', 'counter', [
      { name: 'nexus_model_tokens_total', help: '', type: 'counter',
        labels: { provider }, value: m.totalTokens },
    ]);

    // Latency histogram per provider
    const buckets = histogramBuckets(`model_${provider}`);
    const latencies = latencyBuckets[`model_${provider}`] ?? [];
    const sum  = latencies.reduce((a, b) => a + b, 0);
    const hist = [
      `# HELP nexus_model_latency_ms Distribution of model call latencies`,
      `# TYPE nexus_model_latency_ms histogram`,
      ...buckets.map(b => `nexus_model_latency_ms_bucket{provider="${provider}",le="${b.le}"} ${b.count}`),
      `nexus_model_latency_ms_bucket{provider="${provider}",le="+Inf"} ${latencies.length}`,
      `nexus_model_latency_ms_sum{provider="${provider}"} ${sum}`,
      `nexus_model_latency_ms_count{provider="${provider}"} ${latencies.length}`,
    ];
    lines.push(...hist);
  }

  // ── Tool metrics ──────────────────────────────────────────────────────────
  for (const [name, t] of Object.entries(report.tools)) {
    write('nexus_tool_calls_total', 'Total tool calls', 'counter', [
      { name: 'nexus_tool_calls_total', help: '', type: 'counter', labels: { tool: name, status: 'success' }, value: t.successes },
      { name: 'nexus_tool_calls_total', help: '', type: 'counter', labels: { tool: name, status: 'failure' }, value: t.failures  },
    ]);
  }

  // ── Memory metrics ────────────────────────────────────────────────────────
  write('nexus_memory_ops_total', 'Memory operations by type', 'counter', [
    { name: 'nexus_memory_ops_total', help: '', type: 'counter', labels: { op: 'read'   }, value: report.memory.reads   },
    { name: 'nexus_memory_ops_total', help: '', type: 'counter', labels: { op: 'write'  }, value: report.memory.writes  },
    { name: 'nexus_memory_ops_total', help: '', type: 'counter', labels: { op: 'delete' }, value: report.memory.deletes },
  ]);

  // ── Governance metrics ────────────────────────────────────────────────────
  write('nexus_governance_checks_total', 'Governance checks', 'counter', [
    { name: 'nexus_governance_checks_total', help: '', type: 'counter', labels: { result: 'allowed' }, value: report.governance.checks  - report.governance.denials },
    { name: 'nexus_governance_checks_total', help: '', type: 'counter', labels: { result: 'denied'  }, value: report.governance.denials },
  ]);

  // ── Event bus metrics ─────────────────────────────────────────────────────
  write('nexus_events_total', 'Total events emitted', 'counter', [
    { name: 'nexus_events_total', help: '', type: 'counter', labels: {}, value: report.events.total },
  ]);

  // Timestamp
  lines.push(`\n# Last scraped: ${new Date(now).toISOString()}`);

  return lines.join('\n') + '\n';
}
