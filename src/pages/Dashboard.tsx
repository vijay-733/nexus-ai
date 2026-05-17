import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  Activity, Zap, CheckCircle2, Clock, Terminal, TrendingUp,
  ArrowRight, BarChart3, Layers, GitBranch,
} from 'lucide-react';
import { observabilityApi } from '../lib/api';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { Skeleton } from '../components/ui/Skeleton';

const FADE_UP = (delay = 0) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, delay, ease: 'easeOut' as const },
});

function StatCard({
  label, value, sub, icon: Icon, accent, loading,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: string; loading?: boolean;
}) {
  return (
    <div
      className="stat-card p-4 group"
      style={accent ? { '--accent': accent } as React.CSSProperties : undefined}
    >
      {/* Top accent line on hover */}
      <div
        className="absolute top-0 left-0 right-0 h-px rounded-t-[14px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `linear-gradient(90deg, ${accent ?? 'var(--color-nexus-accent)'}, transparent)` }}
      />
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
          style={{ background: 'var(--color-nexus-elevated)', border: '1px solid var(--color-nexus-border)' }}
        >
          <Icon size={16} style={{ color: accent ?? 'var(--color-nexus-accent)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--color-text-muted)] leading-tight">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-14 mt-1" />
          ) : (
            <p className="text-2xl font-bold text-[var(--color-text-primary)] tabular-nums tracking-tight leading-tight mt-0.5">
              {value}
            </p>
          )}
          {sub && (
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1 font-medium">{sub}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const MODE_ICON: Record<string, React.ElementType> = {
  orchestrate: GitBranch,
  multi:       Layers,
  react:       Zap,
};

const STATUS_COLOR: Record<string, string> = {
  done:    'var(--color-nexus-green)',
  error:   'var(--color-nexus-red)',
  partial: 'var(--color-nexus-amber)',
};

export default function Dashboard() {
  const { sessionHistory, isRunning, currentSession, setPage } = useAppStore();
  const { user, refreshUser } = useAuthStore();

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const { data: metrics, isLoading, isError } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => observabilityApi.metrics(),
    refetchInterval: 15_000,
    retry: 1,
  });

  const done       = sessionHistory.filter(s => s.status === 'done').length;
  const timedSessions = sessionHistory.filter(s => s.durationMs && s.durationMs > 0);
  const avgMs      = timedSessions.length > 0
    ? timedSessions.reduce((a, s) => a + (s.durationMs ?? 0), 0) / timedSessions.length : 0;
  const recent     = sessionHistory.slice(0, 8);

  const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
  const sessionsToday = sessionHistory.filter(s => s.startedAt >= todayMidnight.getTime()).length;

  const modeCounts = sessionHistory.reduce<Record<string, number>>((acc, s) => {
    acc[s.mode] = (acc[s.mode] ?? 0) + 1; return acc;
  }, {});
  const topMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const displayName = user?.name ?? user?.email?.split('@')[0] ?? '';

  const systemHealth = [
    { name: 'Agent Runtime',  ok: true },
    { name: 'Memory System',  ok: true },
    { name: 'Event Bus',      ok: true },
    { name: 'API Gateway',    ok: !isLoading && !isError && !!metrics },
  ];

  return (
    <div className="p-5 sm:p-7 space-y-6 max-w-5xl mx-auto">

      {/* ── Header ── */}
      <motion.div {...FADE_UP(0)}>
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] tracking-tight">
          {greeting}{displayName ? `, ${displayName}` : ''}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {isRunning
            ? `Agent running — ${currentSession?.steps.length ?? 0} steps completed`
            : sessionHistory.length === 0
            ? 'Ready to orchestrate your first task.'
            : `${sessionHistory.length} session${sessionHistory.length !== 1 ? 's' : ''} · ${done} completed successfully`
          }
        </p>
      </motion.div>

      {/* ── Live execution banner ── */}
      {isRunning && currentSession && (
        <motion.button
          {...FADE_UP(0.05)}
          onClick={() => setPage('workspace')}
          className="w-full text-left rounded-[14px] p-4 flex items-center gap-4 transition-colors duration-150 hover:brightness-110"
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.07), rgba(245,158,11,0.03))',
            border: '1px solid rgba(245,158,11,0.2)',
          }}
        >
          <div className="relative shrink-0">
            <span
              className="w-2.5 h-2.5 rounded-full block animate-pulse"
              style={{ background: 'var(--color-nexus-amber)' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{currentSession.task}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="amber">{currentSession.mode}</Badge>
              <span className="text-xs text-[var(--color-text-muted)]">{currentSession.steps.length} steps</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-[var(--color-nexus-amber)] shrink-0">
            <span>View</span>
            <ArrowRight size={13} />
          </div>
        </motion.button>
      )}

      {/* ── Stats grid ── */}
      <motion.div {...FADE_UP(0.08)} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Sessions"
          value={sessionHistory.length}
          icon={Activity}
          accent="var(--color-nexus-accent)"
          sub={sessionsToday > 0 ? `${sessionsToday} today` : 'none today'}
        />
        <StatCard
          label="Completed"
          value={done}
          icon={CheckCircle2}
          accent="var(--color-nexus-green)"
          sub={sessionHistory.length > 0 ? `${Math.round((done / sessionHistory.length) * 100)}% success rate` : '—'}
        />
        <StatCard
          label="Avg Duration"
          value={timedSessions.length > 0 ? `${(avgMs / 1000).toFixed(1)}s` : '—'}
          icon={Clock}
          accent="var(--color-nexus-blue)"
          sub={topMode !== '—' ? `top mode: ${topMode}` : undefined}
        />
        <StatCard
          label="Credits"
          value={user?.credits?.toLocaleString() ?? '—'}
          icon={Zap}
          accent="var(--color-nexus-amber)"
          sub={user?.plan ? `${user.plan} plan` : undefined}
        />
      </motion.div>

      {/* ── Main content ── */}
      <motion.div {...FADE_UP(0.12)} className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Recent sessions */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-[var(--color-nexus-accent)]" />
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Recent Activity</h3>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setPage('history')} className="gap-1 h-7">
                All sessions <ArrowRight size={11} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <div className="py-12 text-center">
                <div
                  className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                  style={{ background: 'var(--color-nexus-elevated)', border: '1px solid var(--color-nexus-border)' }}
                >
                  <Terminal size={20} className="text-[var(--color-text-muted)]" />
                </div>
                <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">No sessions yet</p>
                <p className="text-xs text-[var(--color-text-muted)] mb-4">Run your first AI task to see activity here</p>
                <Button variant="primary" size="sm" onClick={() => setPage('workspace')}>
                  Open Workspace
                </Button>
              </div>
            ) : (
              <div>
                {recent.map((s, i) => {
                  const ModeIcon = MODE_ICON[s.mode] ?? Activity;
                  const statusColor = STATUS_COLOR[s.status] ?? 'var(--color-text-muted)';
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-nexus-border)] last:border-0 hover:bg-[var(--color-glass-hover)] transition-colors"
                    >
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: 'var(--color-nexus-elevated)', border: '1px solid var(--color-nexus-border)' }}
                      >
                        <ModeIcon size={12} style={{ color: statusColor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">{s.task}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-[var(--color-text-muted)] capitalize">{s.mode}</span>
                          {s.durationMs && (
                            <>
                              <span className="text-[var(--color-nexus-border-2)]">·</span>
                              <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">{(s.durationMs / 1000).toFixed(1)}s</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: statusColor }}
                      />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right panel */}
        <div className="lg:col-span-2 space-y-3">

          {/* Quick actions */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-[var(--color-nexus-accent)]" />
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Quick Actions</h3>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {[
                { label: 'Open Workspace',     icon: Terminal,   page: 'workspace',     color: 'var(--color-nexus-accent)'  },
                { label: 'Browse Workflows',   icon: Activity,   page: 'workflows',     color: 'var(--color-nexus-purple)'  },
                { label: 'View Observability', icon: BarChart3,  page: 'observability', color: 'var(--color-nexus-blue)'    },
              ].map(({ label, icon: Icon, page, color }) => (
                <button
                  key={page}
                  onClick={() => setPage(page as any)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] hover:bg-[var(--color-glass-hover)] transition-colors group"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                    style={{ background: 'var(--color-nexus-elevated)', border: '1px solid var(--color-nexus-border)' }}
                  >
                    <Icon size={13} style={{ color }} />
                  </div>
                  <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors flex-1 text-left">
                    {label}
                  </span>
                  <ArrowRight size={12} className="text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </CardContent>
          </Card>

          {/* System health */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 size={14} className="text-[var(--color-nexus-blue)]" />
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">System Health</h3>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2.5">
              {systemHealth.map(({ name, ok }) => (
                <div key={name} className="flex items-center gap-2.5">
                  <StatusDot status={ok ? 'active' : 'idle'} size="sm" />
                  <span className="text-xs text-[var(--color-text-secondary)] flex-1">{name}</span>
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: ok ? 'var(--color-nexus-green)' : 'var(--color-text-muted)' }}
                  >
                    {ok ? 'healthy' : 'unknown'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
