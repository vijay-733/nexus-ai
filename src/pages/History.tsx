import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, History as HistoryIcon, ChevronRight, Clock, Play, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { EmptyState } from '../components/ui/EmptyState';
import { StreamingText } from '../components/workspace/StreamingText';
import { cn } from '../lib/utils';

type StatusFilter = 'all' | 'done' | 'error';
type ModeFilter   = 'all' | 'orchestrate' | 'multi' | 'react';

export default function History() {
  const { sessionHistory, setPage, setPendingTask, deleteSession, isRunning } = useAppStore();
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState<StatusFilter>('all');
  const [mode,    setMode]    = useState<ModeFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = sessionHistory.filter(s => {
    if (status !== 'all' && s.status !== status) return false;
    if (mode   !== 'all' && s.mode   !== mode)   return false;
    if (search && !s.task.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Run History</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {sessionHistory.length} total sessions · {sessionHistory.filter(s => s.status === 'done').length} completed
        </p>
      </div>

      {sessionHistory.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No history yet"
          description="Completed sessions will appear here. Run your first task in the Workspace to get started."
          action={{ label: 'Open Workspace', onClick: () => setPage('workspace'), variant: 'primary' }}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tasks..."
                className="w-full h-8 pl-8 pr-3 rounded-lg text-xs bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-nexus-accent)] focus:outline-none"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'done', 'error'] as StatusFilter[]).map(f => (
                <button key={f} onClick={() => setStatus(f)}
                  className={cn('text-xs px-2.5 py-1 rounded-lg border transition-colors',
                    status === f ? 'bg-[var(--color-nexus-accent-3)] border-[rgba(0,229,160,0.2)] text-[var(--color-nexus-accent)]'
                                 : 'border-[var(--color-nexus-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                  )}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'orchestrate', 'multi', 'react'] as ModeFilter[]).map(f => (
                <button key={f} onClick={() => setMode(f)}
                  className={cn('text-xs px-2.5 py-1 rounded-lg border transition-colors',
                    mode === f ? 'bg-[var(--color-nexus-accent-3)] border-[rgba(0,229,160,0.2)] text-[var(--color-nexus-accent)]'
                               : 'border-[var(--color-nexus-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                  )}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[var(--color-text-muted)]">No sessions match filters</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((session, i) => (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="surface rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setExpanded(expanded === session.id ? null : session.id)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--color-glass-hover)] transition-colors"
                  >
                    <StatusDot
                      status={session.status === 'done' ? 'done' : session.status === 'error' ? 'error' : 'idle'}
                    />
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm text-[var(--color-text-primary)] truncate">{session.task}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {session.workflowLabel && (
                          <Badge variant="accent" size="sm">{session.workflowLabel}</Badge>
                        )}
                        <Badge variant="outline" size="sm">{session.mode}</Badge>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {new Date(session.startedAt).toLocaleString()}
                        </span>
                        {session.steps.length > 0 && (
                          <span className="text-[10px] text-[var(--color-text-muted)]">{session.steps.length} steps</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {session.durationMs && (
                        <span className="text-xs text-[var(--color-text-muted)] font-mono flex items-center gap-1">
                          <Clock size={10} />
                          {(session.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      <Badge
                        variant={session.status === 'done' ? 'accent' : session.status === 'error' ? 'red' : 'default'}
                        size="sm"
                      >
                        {session.status}
                      </Badge>
                      <ChevronRight size={13} className={cn(
                        'text-[var(--color-text-muted)] transition-transform duration-150',
                        expanded === session.id && 'rotate-90'
                      )} />
                    </div>
                  </button>

                  <AnimatePresence>
                    {expanded === session.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-[var(--color-nexus-border)]"
                      >
                        <div className="px-5 py-4 space-y-3">
                          {session.result?.finalAnswer && (
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Result</p>
                              <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed line-clamp-6">
                                <StreamingText content={session.result.finalAnswer} />
                              </div>
                            </div>
                          )}
                          {session.error && (
                            <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.12)] rounded-lg p-3">
                              <p className="text-xs text-[var(--color-nexus-red)] font-mono">{session.error}</p>
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-nexus-border)]">
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={isRunning}
                              onClick={() => {
                                setPendingTask(session.task, session.mode, session.workflowLabel);
                                setPage('workspace');
                              }}
                              className="gap-1.5"
                            >
                              <Play size={11} />
                              Re-run
                            </Button>
                            <div className="flex-1" />
                            <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
                              {session.result?.supervisorScore != null && (
                                <span>Quality: {session.result.supervisorScore}/100</span>
                              )}
                              {session.result?.usage && (
                                <span>{session.result.usage.creditsUsed} credits</span>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                deleteSession(session.id);
                                if (expanded === session.id) setExpanded(null);
                              }}
                              title="Delete session"
                              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-nexus-red)] hover:bg-[rgba(239,68,68,0.08)] transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
