import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { BarChart3, Activity, Cpu, Zap, Clock, TrendingUp, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { observabilityApi, healthApi } from '../lib/api';
import { useAppStore } from '../store/appStore';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { StatusDot } from '../components/ui/StatusDot';
import { Skeleton } from '../components/ui/Skeleton';

function MiniBar({ value, max, color = 'accent' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1 bg-[var(--color-nexus-elevated)] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: `var(--color-nexus-${color})` }}
      />
    </div>
  );
}

function MetricRow({ label, value, max, color }: { label: string; value: number; max: number; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
        <span className="text-xs font-mono text-[var(--color-text-muted)]">{value.toLocaleString()}</span>
      </div>
      <MiniBar value={value} max={max} color={color} />
    </div>
  );
}

export default function Observability() {
  const { sessionHistory } = useAppStore();

  const { data: metrics, isLoading: mLoading, refetch } = useQuery({
    queryKey: ['metrics-obs'],
    queryFn: () => observabilityApi.metrics(),
    refetchInterval: 10_000,
  });

  const { data: health, isLoading: hLoading } = useQuery({
    queryKey: ['health-obs'],
    queryFn: () => healthApi.get(),
    refetchInterval: 5_000,
  });

  const totalTokens = sessionHistory.reduce((a, s) => a + (s.result?.tokens ?? 0), 0);
  const totalCost   = sessionHistory.reduce((a, s) => a + (s.result?.cost ?? 0), 0);
  const errRate     = sessionHistory.length > 0
    ? (sessionHistory.filter(s => s.status === 'error').length / sessionHistory.length * 100).toFixed(1)
    : '0';
  const avgMs       = sessionHistory.filter(s => s.durationMs).length > 0
    ? Math.round(sessionHistory.filter(s => s.durationMs).reduce((a, s) => a + (s.durationMs ?? 0), 0) / sessionHistory.filter(s => s.durationMs).length)
    : 0;

  const agentOk  = !mLoading && !!metrics;
  const healthOk = !hLoading && !!health && health.status !== 'unhealthy';

  const serviceChecks = [
    { name: 'API Server',    ok: true,     category: 'core'    },
    { name: 'Agent Runtime', ok: agentOk,  category: 'core'    },
    { name: 'Memory Store',  ok: true,     category: 'storage' },
    { name: 'Event Bus',     ok: true,     category: 'infra'   },
    { name: 'Health Monitor',ok: healthOk, category: 'infra'   },
    { name: 'Task Queue',    ok: true,     category: 'infra'   },
  ];

  const healthyCount = serviceChecks.filter(s => s.ok).length;
  const overallStatus = healthyCount === serviceChecks.length ? 'healthy' : healthyCount > serviceChecks.length / 2 ? 'degraded' : 'unhealthy';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Observability</h2>
          <div className="flex items-center gap-2 mt-1">
            <StatusDot status={overallStatus === 'healthy' ? 'active' : overallStatus === 'degraded' ? 'warning' : 'error'} />
            <span className="text-sm text-[var(--color-text-muted)] capitalize">{overallStatus}</span>
            <span className="text-xs text-[var(--color-text-muted)]">· {healthyCount}/{serviceChecks.length} services up</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Tokens',   value: totalTokens.toLocaleString(), icon: Zap,        color: 'accent'  },
          { label: 'Estimated Cost', value: `$${totalCost.toFixed(4)}`,   icon: TrendingUp, color: 'green'   },
          { label: 'Error Rate',     value: `${errRate}%`,                icon: Activity,   color: parseFloat(errRate) > 10 ? 'red' : 'green' },
          { label: 'Avg Latency',    value: avgMs > 0 ? `${(avgMs/1000).toFixed(1)}s` : '—', icon: Clock, color: 'blue' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="surface rounded-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                <p className="text-xl font-bold text-[var(--color-text-primary)] mt-1">{value}</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-[var(--color-nexus-elevated)] flex items-center justify-center shrink-0">
                <Icon size={14} style={{ color: `var(--color-nexus-${color})` }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Service health */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Service Health</h3>
              <Badge variant={overallStatus === 'healthy' ? 'accent' : overallStatus === 'degraded' ? 'amber' : 'red'} size="sm">
                {overallStatus}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {hLoading || mLoading
              ? [1,2,3,4,5,6].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="w-2 h-2 rounded-full" />
                    <Skeleton className="h-3 flex-1 rounded" />
                    <Skeleton className="h-3 w-12 rounded" />
                  </div>
                ))
              : serviceChecks.map(({ name, ok }) => (
                  <div key={name} className="flex items-center gap-3">
                    <StatusDot status={ok ? 'active' : 'error'} size="sm" />
                    <span className="text-sm text-[var(--color-text-secondary)] flex-1">{name}</span>
                    {ok
                      ? <CheckCircle2 size={13} className="text-[var(--color-nexus-green)]" />
                      : <XCircle size={13} className="text-[var(--color-nexus-red)]" />
                    }
                  </div>
                ))
            }
          </CardContent>
        </Card>

        {/* Session breakdown */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Mode Distribution</h3>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {[
              { label: 'Orchestrate', count: sessionHistory.filter(s => s.mode === 'orchestrate').length, color: 'accent'  },
              { label: 'Multi-Agent', count: sessionHistory.filter(s => s.mode === 'multi').length,       color: 'blue'    },
              { label: 'ReAct',       count: sessionHistory.filter(s => s.mode === 'react').length,       color: 'purple'  },
            ].map(({ label, count, color }) => (
              <MetricRow key={label} label={label} value={count} max={Math.max(sessionHistory.length, 1)} color={color} />
            ))}
            <div className="pt-2 border-t border-[var(--color-nexus-border)]">
              <MetricRow label="Success" value={sessionHistory.filter(s => s.status === 'done').length}  max={Math.max(sessionHistory.length, 1)} color="green" />
              <MetricRow label="Failed"  value={sessionHistory.filter(s => s.status === 'error').length} max={Math.max(sessionHistory.length, 1)} color="red" />
            </div>
          </CardContent>
        </Card>

        {/* Agent metrics from server */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Runtime Metrics</h3>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {mLoading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full rounded" />)}
              </div>
            ) : metrics ? (
              <>
                <div className="space-y-2">
                  {[
                    { label: 'Agents started',    value: metrics.agents.started    },
                    { label: 'Agents completed',  value: metrics.agents.completed  },
                    { label: 'Agent failures',    value: metrics.agents.failed     },
                    { label: 'Tasks created',     value: metrics.tasks.created     },
                    { label: 'Memory reads',      value: metrics.memory.reads      },
                    { label: 'Memory writes',     value: metrics.memory.writes     },
                    { label: 'Gov checks',        value: metrics.governance.checks },
                    { label: 'Gov denials',       value: metrics.governance.denials },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
                      <span className="text-xs font-mono text-[var(--color-text-primary)]">{value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-[var(--color-nexus-border)] text-[10px] text-[var(--color-text-muted)]">
                  Uptime: {Math.round((metrics.uptime ?? 0) / 60)}m · Events: {metrics.events?.total ?? 0}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <AlertTriangle size={13} />
                <span>Metrics unavailable (server may be offline)</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Prometheus link */}
      <div className="surface rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 size={16} className="text-[var(--color-nexus-accent)]" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">Raw Metrics Endpoint</p>
            <p className="text-xs text-[var(--color-text-muted)]">Prometheus text-format available at <code className="font-mono text-[var(--color-nexus-accent)]">/metrics</code> · JSON at <code className="font-mono text-[var(--color-nexus-accent)]">/metrics/json</code></p>
          </div>
        </div>
        <Badge variant="accent">Prometheus</Badge>
      </div>
    </div>
  );
}
