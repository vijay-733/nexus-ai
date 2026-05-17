import { motion } from 'motion/react';
import { GitBranch, Cpu, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';

export default function Traces() {
  const { sessionHistory, setPage } = useAppStore();

  const allSteps = sessionHistory.flatMap(session =>
    session.steps.map(step => ({
      ...step,
      sessionId:   session.id,
      sessionTask: session.task,
      sessionMode: session.mode,
    }))
  ).slice(0, 150);

  if (allSteps.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">Execution Traces</h2>
        <p className="text-sm text-[var(--color-text-muted)] mb-6">Step-level execution visibility across all agent runs</p>
        <EmptyState
          icon={GitBranch}
          title="No traces yet"
          description="Execution traces appear here as agents run. Each step shows the agent's reasoning, tool calls, and outputs."
          action={{ label: 'Run a task', onClick: () => setPage('workspace'), variant: 'primary' }}
        />
      </div>
    );
  }

  // Group by session
  const grouped = sessionHistory
    .filter(s => s.steps.length > 0)
    .map(s => ({ session: s, steps: s.steps }))
    .slice(0, 20);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Execution Traces</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {allSteps.length} total steps across {sessionHistory.length} sessions
        </p>
      </div>

      <div className="space-y-4">
        {grouped.map(({ session, steps }, gi) => (
          <div key={session.id} className="surface rounded-xl overflow-hidden">
            {/* Session header */}
            <div className="px-5 py-3 border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-elevated)] flex items-center gap-3">
              <GitBranch size={13} className="text-[var(--color-nexus-accent)] shrink-0" />
              <p className="text-xs font-medium text-[var(--color-text-primary)] flex-1 truncate">{session.task}</p>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" size="sm">{session.mode}</Badge>
                <Badge
                  variant={session.status === 'done' ? 'accent' : session.status === 'error' ? 'red' : 'default'}
                  size="sm"
                >
                  {session.status}
                </Badge>
              </div>
            </div>

            {/* Steps */}
            <div className="divide-y divide-[var(--color-nexus-border)]">
              {steps.map((step, i) => (
                <motion.div
                  key={step.stepId ?? i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: gi * 0.05 + i * 0.03 }}
                  className="px-5 py-3 flex items-start gap-4 hover:bg-[var(--color-glass-hover)] transition-colors"
                >
                  {/* Timeline dot + connector */}
                  <div className="flex flex-col items-center shrink-0 pt-0.5">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-nexus-accent)] shrink-0" />
                    {i < steps.length - 1 && (
                      <div className="w-px flex-1 bg-[var(--color-nexus-border)] mt-1 min-h-[16px]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">
                        {step.agentType
                          ? `${step.agentType.charAt(0).toUpperCase()}${step.agentType.slice(1)} Agent`
                          : `Step ${i + 1}`}
                      </span>
                      {step.tool && <Badge variant="blue" size="sm">{step.tool}</Badge>}
                      {step.status === 'done'   && <CheckCircle2 size={12} className="text-[var(--color-nexus-green)]" />}
                      {step.status === 'error'  && <XCircle size={12} className="text-[var(--color-nexus-red)]" />}
                      {step.status === 'running' && <Loader2 size={12} className="text-[var(--color-nexus-amber)] animate-spin" />}
                      {step.durationMs && (
                        <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1 ml-auto">
                          <Clock size={9} />
                          {(step.durationMs / 1000).toFixed(2)}s
                        </span>
                      )}
                    </div>
                    {step.reasoning && (
                      <p className="text-xs text-[var(--color-text-muted)] line-clamp-2 leading-relaxed">
                        {step.reasoning}
                      </p>
                    )}
                    {step.input && !step.reasoning && (
                      <p className="text-xs text-[var(--color-text-muted)] truncate">{step.input}</p>
                    )}
                    {step.error && (
                      <p className="text-xs text-[var(--color-nexus-red)] font-mono mt-1 truncate">{step.error}</p>
                    )}
                    {step.tokens && (
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{step.tokens.toLocaleString()} tokens</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
