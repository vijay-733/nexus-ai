import { useState, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, Loader2, Clock, ChevronDown,
  Cpu, Brain, Search, Globe, Image, Zap, GitBranch,
  Shield, Eye, RotateCcw, Layers, AlertTriangle,
  Copy, Check,
} from 'lucide-react';
import type { ExecutionSession, NormalizedStep } from '../../store/appStore';
import { StreamingText } from './StreamingText';
import { Badge } from '../ui/Badge';
import { StatusDot } from '../ui/StatusDot';
import { cn } from '../../lib/utils';

function downloadDataUrl(dataUrl: string, filename: string) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bytes = atob(b64);
  const u8 = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes.charCodeAt(i);
  const blob = new Blob([u8], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Icon maps ─────────────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, React.ElementType> = {
  react:         Zap,
  planner:       GitBranch,
  text:          Zap,
  research:      Search,
  memory:        Brain,
  supervisor:    Eye,
  recovery:      RotateCcw,
  governance:    Shield,
  orchestrator:  Layers,
};

const TOOL_ICONS: Record<string, React.ElementType> = {
  'text-generation':  Zap,
  'image-generation': Image,
  'memory-read':      Brain,
  'memory-write':     Brain,
  'memory-delete':    Brain,
  'research':         Search,
  'web-fetch':        Globe,
};

const STATUS_LABEL: Record<string, string> = {
  idle:     'Queued',
  planning: 'Planning',
  running:  'Running',
  streaming:'Streaming',
  done:     'Completed',
  partial:  'Partial Success',
  error:    'Failed',
};

// ── Live running indicator ────────────────────────────────────────────────────

function RunningIndicator({ session }: { session: ExecutionSession }) {
  const [elapsed, setElapsed] = useState(
    Math.floor((Date.now() - session.startedAt) / 1000)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - session.startedAt) / 1000));
    }, 1_000);
    return () => clearInterval(id);
  }, [session.startedAt]);

  const getMessage = (): string => {
    if (session.status === 'planning') {
      return elapsed < 3 ? 'Validating request…' : 'Planning execution steps…';
    }
    // running
    const { mode } = session;
    if (elapsed < 8)  return mode === 'react' ? 'Thinking…' : 'Dispatching agents…';
    if (elapsed < 25) return mode === 'react' ? 'Acting on observations…' : 'Agents executing…';
    if (elapsed < 60) return 'Synthesizing results…';
    return 'Finalizing…';
  };

  const dots = '.'.repeat((Math.floor(elapsed / 0.5) % 4));

  const pct = Math.min((elapsed / (session.mode === 'react' ? 45 : session.mode === 'orchestrate' ? 90 : 60)) * 100, 95);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className="rounded-[14px] p-4 overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, var(--color-nexus-surface-2), rgba(79,142,247,0.03))',
        border: '1px solid rgba(79,142,247,0.18)',
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 animate-exec-pulse"
          style={{ background: 'var(--color-nexus-blue-dim)', border: '1px solid rgba(79,142,247,0.2)' }}
        >
          <Loader2 size={15} style={{ color: 'var(--color-nexus-blue)' }} className="animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] tracking-tight">
            {getMessage()}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {session.mode} mode
            {elapsed > 90 && ' · this may take a moment longer'}
          </p>
        </div>
        <span
          className="text-sm font-mono tabular-nums shrink-0"
          style={{ color: 'var(--color-nexus-blue)' }}
        >
          {elapsed}s
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--color-nexus-border)' }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ background: 'linear-gradient(90deg, var(--color-nexus-blue), var(--color-nexus-accent))' }}
        />
      </div>
    </motion.div>
  );
}

// ── Plan progress track ───────────────────────────────────────────────────────

const PlanTrack = memo(function PlanTrack({ session }: { session: ExecutionSession }) {
  if (!session.plan?.length) return null;

  const completedCount = session.steps.filter(s => s.status === 'done').length;
  const failedCount    = session.steps.filter(s => s.status === 'failed' || s.status === 'error').length;
  const pct = (completedCount / session.plan.length) * 100;

  return (
    <div className="rounded-[12px] p-4 space-y-3" style={{ background: 'var(--color-nexus-surface-2)', border: '1px solid var(--color-nexus-border)' }}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[var(--color-text-muted)]">Execution Plan</p>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-[var(--color-text-muted)] tabular-nums">{completedCount}/{session.plan.length}</span>
          {failedCount > 0 && (
            <span style={{ color: 'var(--color-nexus-red)' }}>{failedCount} failed</span>
          )}
        </div>
      </div>

      <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--color-nexus-border)' }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ background: 'linear-gradient(90deg, var(--color-nexus-accent), var(--color-nexus-blue))' }}
        />
      </div>

      <div className="space-y-1.5">
        {session.plan.map((step, i) => {
          const stepResult = session.steps.find(s =>
            s.stepId === step.id || s.stepId === `react-step-${i + 1}`
          );
          const isDone   = stepResult?.status === 'done';
          const isFailed = stepResult?.status === 'failed' || stepResult?.status === 'error';
          // A step is "active" (spinning) when its placeholder has status 'running'
          // OR when it's the next unstarted step in a live session.
          // The second condition uses session.steps.filter(non-running).length so
          // that 'running' placeholder steps (added by setRunningStep) don't
          // incorrectly advance the "next step" pointer.
          const nonRunningCount = session.steps.filter(s => s.status !== 'running').length;
          const isActive = stepResult?.status === 'running' || (
            !stepResult && i === nonRunningCount &&
            (session.status === 'running' || session.status === 'planning' || session.status === 'streaming')
          );

          return (
            <div key={step.id} className="flex items-center gap-3">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all',
                isDone   ? 'bg-[var(--color-nexus-accent-3)] text-[var(--color-nexus-accent)]' :
                isFailed ? 'bg-[rgba(239,68,68,0.1)] text-[var(--color-nexus-red)]' :
                isActive ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-nexus-amber)]' :
                           'bg-[var(--color-nexus-elevated)] text-[var(--color-text-muted)]'
              )}>
                {isDone   ? '✓' :
                 isFailed ? '✕' :
                 isActive ? <Loader2 size={10} className="animate-spin" /> :
                            i + 1}
              </div>
              <span className={cn(
                'text-xs flex-1 transition-colors',
                isDone   ? 'text-[var(--color-text-muted)] line-through' :
                isFailed ? 'text-[var(--color-nexus-red)]' :
                isActive ? 'text-[var(--color-text-primary)] font-medium' :
                           'text-[var(--color-text-muted)]'
              )}>
                {step.description ?? step.task}
              </span>
              {stepResult?.durationMs && (
                <span className="text-[10px] text-[var(--color-text-muted)] font-mono shrink-0">
                  {(stepResult.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── Individual step entry ─────────────────────────────────────────────────────
// Memoised: appendStreamStep replaces only one step object in the array while
// all other step objects keep their existing reference.  memo() bails on those
// unchanged steps so only the actually-updated step re-renders each tick.

const StepEntry = memo(function StepEntry({ step, index }: { step: NormalizedStep; index: number }) {
  // Auto-expand failed steps so the error is immediately visible
  const [open, setOpen] = useState(
    step.status === 'error' || step.status === 'failed'
  );

  const AgentIcon = AGENT_ICONS[step.agentType ?? ''] ?? Cpu;
  const ToolIcon  = step.tool ? (TOOL_ICONS[step.tool] ?? Cpu) : null;

  // The display label: react steps show the action, multi/orchestrate show the task
  const label = step.agentType === 'react'
    ? (step.action
        ? step.action.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : `Step ${index + 1}`)
    : (step.task?.slice(0, 80) ?? `Step ${index + 1}`);

  // The subtitle shown under the label
  const subtitle = step.agentType === 'react'
    ? step.actionInput?.slice(0, 100)
    : undefined;

  // Primary content to show when expanded (observation for react, content for others)
  const outputText = step.agentType === 'react'
    ? (step.observation ?? step.content)
    : step.content;

  // Reasoning / thought to show above output
  const reasoningText = step.thought ?? step.reasoning;

  const isDoneStep  = step.status === 'done';
  const isErrorStep = step.status === 'error' || step.status === 'failed';
  const isRunStep   = step.status === 'running';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn('step-card overflow-hidden', isDoneStep && 'done', isErrorStep && 'error', isRunStep && 'running')}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-glass-hover)] transition-colors text-left"
      >
        <span className="w-5 text-[10px] text-[var(--color-text-muted)] font-mono shrink-0 text-right tabular-nums">
          {index + 1}
        </span>

        <div
          className="w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0"
          style={{
            background: isRunStep
              ? 'var(--color-nexus-blue-dim)'
              : isDoneStep
              ? 'var(--color-nexus-accent-4)'
              : isErrorStep
              ? 'var(--color-nexus-red-dim)'
              : 'var(--color-nexus-elevated)',
            border: `1px solid ${isRunStep ? 'rgba(79,142,247,0.2)' : isDoneStep ? 'rgba(0,229,160,0.15)' : isErrorStep ? 'rgba(240,76,94,0.2)' : 'var(--color-nexus-border)'}`,
          }}
        >
          <AgentIcon
            size={12}
            style={{
              color: isRunStep ? 'var(--color-nexus-blue)' : isDoneStep ? 'var(--color-nexus-accent)' : isErrorStep ? 'var(--color-nexus-red)' : 'var(--color-text-muted)',
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
              {label}
            </span>
            {ToolIcon && step.tool && (
              <Badge variant="blue" size="sm">
                <ToolIcon size={9} className="mr-1" />
                {step.tool.replace(/-/g, ' ')}
              </Badge>
            )}
            {step.provider && step.provider !== 'agent' && (
              <Badge variant="outline" size="sm">{step.provider}</Badge>
            )}
          </div>
          {subtitle && (
            <p className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {step.tokens && (
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono hidden sm:block">
              {step.tokens.toLocaleString()}t
            </span>
          )}
          {step.durationMs != null && step.durationMs > 0 && (
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
              {(step.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {step.status === 'done'                                     && <CheckCircle2 size={13} className="text-[var(--color-nexus-green)]" />}
          {(step.status === 'error' || step.status === 'failed')      && <XCircle      size={13} className="text-[var(--color-nexus-red)]" />}
          {step.status === 'running'                                  && <Loader2      size={13} className="text-[var(--color-nexus-amber)] animate-spin" />}
          <ChevronDown size={13} className={cn(
            'text-[var(--color-text-muted)] transition-transform duration-150',
            open && 'rotate-180'
          )} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-[var(--color-nexus-border)]"
          >
            <div className="px-4 py-3 space-y-3">
              {reasoningText && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 flex items-center gap-1.5">
                    <Brain size={10} /> Reasoning
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed italic">
                    {reasoningText}
                  </p>
                </div>
              )}

              {outputText && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">
                    {step.agentType === 'react' ? 'Observation' : 'Output'}
                  </p>
                  {step.type === 'image' && outputText.startsWith('data:image/') ? (
                    <img
                      src={outputText}
                      alt={step.task}
                      className="w-full max-w-sm rounded-xl border border-[var(--color-nexus-border)]"
                    />
                  ) : (
                    <StreamingText
                      content={typeof outputText === 'string' ? outputText : JSON.stringify(outputText, null, 2)}
                      markdown={typeof outputText === 'string'}
                    />
                  )}
                </div>
              )}

              {step.error && (
                <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] rounded-lg p-3">
                  <p className="text-xs text-[var(--color-nexus-red)] font-mono leading-relaxed">{step.error}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ── Final answer block with copy + word count ─────────────────────────────────

function FinalAnswerBlock({ session }: { session: ExecutionSession }) {
  const [copied, setCopied] = useState(false);
  const answer = session.result!.finalAnswer;
  const isImage = answer.startsWith('data:image/');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(answer).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }).catch(() => { /* clipboard denied */ });
  }, [answer]);

  const wordCount = isImage ? 0 : answer.trim().split(/\s+/).filter(Boolean).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="rounded-[14px] p-5"
      style={{
        background: 'linear-gradient(135deg, var(--color-nexus-elevated), rgba(0,229,160,0.02))',
        border: '1px solid rgba(0,229,160,0.18)',
        borderLeft: '3px solid var(--color-nexus-accent)',
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle2 size={14} style={{ color: 'var(--color-nexus-accent)' }} />
        <p className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--color-nexus-accent)' }}>
          {session.status === 'partial' ? 'Partial Result' : session.status === 'error' ? 'Output (partial)' : 'Result'}
        </p>
        {session.result!.supervisorScore != null && (
          <Badge variant="accent" size="sm" className="ml-1">
            {session.result!.supervisorScore}/100
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!isImage && wordCount > 0 && (
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {wordCount.toLocaleString()} words
            </span>
          )}
          {!isImage && (
            <button
              onClick={handleCopy}
              title="Copy output"
              className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-nexus-accent)] transition-colors px-1.5 py-1 rounded-lg hover:bg-[var(--color-nexus-elevated)]"
            >
              {copied
                ? <><Check size={11} className="text-[var(--color-nexus-accent)]" /> Copied</>
                : <><Copy size={11} /> Copy</>
              }
            </button>
          )}
        </div>
      </div>

      {isImage ? (
        <div className="space-y-3">
          <img
            src={answer}
            alt={session.task}
            className="w-full max-w-lg rounded-xl border border-[var(--color-nexus-border)] mx-auto block"
          />
          <button
            onClick={() => downloadDataUrl(answer, 'nexus-image.png')}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--color-nexus-accent)] hover:underline"
          >
            Download image
          </button>
        </div>
      ) : (
        <StreamingText content={answer} />
      )}

      {session.result!.usage && (
        <div className="mt-3 pt-3 border-t border-[var(--color-nexus-border)] flex items-center gap-4 flex-wrap text-[10px] text-[var(--color-text-muted)]">
          <span>{session.result!.usage.creditsUsed} credits used</span>
          <span>{session.result!.usage.creditsRemaining} remaining</span>
          {session.result!.totalSteps != null && (
            <span>
              {session.result!.completedSteps ?? session.steps.filter(s => s.status === 'done').length}/
              {session.result!.totalSteps} steps completed
            </span>
          )}
          {session.stoppedBy && session.stoppedBy !== 'finish' && session.stoppedBy !== 'complete' && (
            <span className="text-[var(--color-nexus-amber)]">stopped: {session.stoppedBy}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── Main timeline component ───────────────────────────────────────────────────

export function ExecutionTimeline({ session }: { session: ExecutionSession }) {
  const isLive = session.status === 'planning' || session.status === 'running' || session.status === 'streaming';

  const durationDisplay = session.durationMs
    ? `${(session.durationMs / 1000).toFixed(1)}s`
    : isLive ? null : null;

  const statusVariant = {
    done:     'accent' as const,
    partial:  'amber'  as const,
    error:    'red'    as const,
    running:  'amber'  as const,
    planning: 'blue'   as const,
    streaming:'blue'   as const,
    idle:     'default'as const,
  }[session.status] ?? ('default' as const);

  const statusDot = {
    done:     'done'    as const,
    partial:  'warning' as const,
    error:    'error'   as const,
    running:  'running' as const,
    planning: 'planning'as const,
    streaming:'running' as const,
    idle:     'idle'    as const,
  }[session.status] ?? ('idle' as const);

  return (
    <div className="space-y-4">
      {/* Session header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--color-text-primary)] text-sm leading-snug">
            {session.task}
          </h3>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant={statusVariant}>
              <StatusDot status={statusDot} size="sm" className="mr-1" />
              {STATUS_LABEL[session.status] ?? session.status}
            </Badge>
            <Badge variant="outline">{session.mode}</Badge>
            {durationDisplay && (
              <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                <Clock size={10} />
                {durationDisplay}
              </span>
            )}
            {session.result?.supervisorScore != null && (
              <Badge
                variant={session.result.supervisorScore >= 80 ? 'accent' : 'amber'}
                size="sm"
              >
                Quality: {session.result.supervisorScore}/100
              </Badge>
            )}
            {session.status === 'partial' && (
              <Badge variant="amber" size="sm">
                <AlertTriangle size={9} className="mr-1" />
                Some steps failed
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Live running indicator — AnimatePresence gives it a smooth fade-out
          when the session moves from streaming→done instead of a hard pop. */}
      <AnimatePresence>
        {isLive && <RunningIndicator session={session} />}
      </AnimatePresence>

      {/* Plan track — shown during and after execution */}
      {session.plan?.length ? <PlanTrack session={session} /> : null}

      {/* Step results — filter the 'finish' sentinel (internal react lifecycle marker) */}
      {(() => {
        const visibleSteps = session.steps.filter(s => s.action !== 'finish');
        return visibleSteps.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              Execution trace ({visibleSteps.length} step{visibleSteps.length !== 1 ? 's' : ''})
            </p>
            {visibleSteps.map((step, i) => (
              <StepEntry key={step.stepId ?? i} step={step} index={i} />
            ))}
          </div>
        ) : null;
      })()}

      {/* Final answer — shown whenever there's meaningful output */}
      {session.result?.finalAnswer && session.result.finalAnswer.trim().length > 0 && (
        <FinalAnswerBlock session={session} />
      )}

      {/* Error state */}
      {session.status === 'error' && session.error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={14} className="text-[var(--color-nexus-red)]" />
            <p className="text-xs font-semibold text-[var(--color-nexus-red)]">Execution Failed</p>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] font-mono leading-relaxed">
            {session.error}
          </p>
          {session.error.includes('Backend unreachable') && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Make sure the server is running:{' '}
              <code className="font-mono text-[var(--color-nexus-accent)]">npm run server</code>
            </p>
          )}
          {session.error.includes('timed out') && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              The task exceeded the 130s timeout. Try a simpler prompt or use React mode (fastest).
            </p>
          )}
        </motion.div>
      )}
    </div>
  );
}
