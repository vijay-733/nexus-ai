import { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal, Sparkles, RotateCcw, ChevronRight,
  Zap, Layers, GitBranch, Image, RefreshCw,
  FileText, Code2, Search, Palette, ArrowRight, Square,
} from 'lucide-react';
import { useAppStore, normalizeReActStep, normalizeStepResult } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { agentApi, type ReActStep, type StepResult } from '../lib/api';
import { streamAgent, type StepStartPayload } from '../lib/streamingApi';
import { streamGeminiDirect, getGeminiKey } from '../lib/geminiDirectClient';
import { AgentInput } from '../components/workspace/AgentInput';
import { ExecutionTimeline } from '../components/workspace/ExecutionTimeline';
import { DebugPanel } from '../components/workspace/DebugPanel';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { toast } from '../store/toastStore';
import { dbg } from '../store/debugStore';
import type { RunMode } from '../store/appStore';

// ── Workflow pipeline definitions ──────────────────────────────────────────────
// Each domain has a named pipeline with visible stages and example launch tasks.

export const WORKFLOW_PIPELINES = [
  {
    id:     'content',
    label:  'Content Operations',
    icon:   FileText,
    color:  'purple',
    desc:   'End-to-end content production from research to publishing assets',
    stages: ['Research', 'Outline', 'Draft', 'Refine'],
    mode:   'orchestrate' as RunMode,
    tasks: [
      'Write a comprehensive technical blog post about microservices design patterns with code examples and architecture diagrams',
      'Create a go-to-market strategy for a developer tools startup — include ICP analysis, positioning, and launch channels',
    ],
  },
  {
    id:     'code',
    label:  'Code Workspace',
    icon:   Code2,
    color:  'accent',
    desc:   'Plan, generate, and refine production-ready code and architecture',
    stages: ['Plan', 'Generate', 'Review', 'Refine'],
    mode:   'multi' as RunMode,
    tasks: [
      'Write a Python FastAPI server with JWT auth, rate limiting, RBAC, and full OpenAPI docs',
      'Create a React component library with TypeScript, Tailwind, accessibility compliance, and Storybook',
    ],
  },
  {
    id:     'research',
    label:  'Research Environment',
    icon:   Search,
    color:  'blue',
    desc:   'Deep research, synthesis, and structured knowledge extraction',
    stages: ['Gather', 'Analyze', 'Synthesize', 'Report'],
    mode:   'orchestrate' as RunMode,
    tasks: [
      'Research the latest advances in LLM agent architectures — include ReAct, MRKL, AutoGPT patterns and compare effectiveness',
      'Competitive analysis of B2B SaaS AI productivity tools in 2024 — market sizing, key players, positioning gaps',
    ],
  },
  {
    id:     'visual',
    label:  'Visual Creation',
    icon:   Palette,
    color:  'purple',
    desc:   'Generate visual assets from descriptive prompts',
    stages: ['Concept', 'Generate', 'Refine'],
    mode:   'image' as RunMode,
    tasks: [
      'A futuristic AI workspace interior with holographic displays, neon-lit panels, and a clean minimal aesthetic',
      'Abstract digital art representing neural network connections — electric blue and green energy flows on dark background',
    ],
  },
];

const MODE_INFO = {
  orchestrate: { icon: GitBranch, color: 'var(--color-nexus-accent)',  label: 'Orchestrate', desc: '8-agent pipeline with governance, planning, parallel execution, supervision, and memory' },
  multi:       { icon: Layers,    color: 'var(--color-nexus-blue)',    label: 'Multi-Agent', desc: 'Planner decomposes task into parallel specialist agents' },
  react:       { icon: Zap,       color: 'var(--color-nexus-purple)',  label: 'ReAct',       desc: 'Single agent with think → act → observe loop (fastest)' },
  image:       { icon: Image,     color: 'var(--color-nexus-purple)',  label: 'Image',       desc: 'Generate images from a text description using Pollinations (free) or DALL-E / Stability AI' },
};

export default function Workspace() {
  const runMode          = useAppStore(s => s.runMode);
  const setRunMode       = useAppStore(s => s.setRunMode);
  const currentSession   = useAppStore(s => s.currentSession);
  const isRunning        = useAppStore(s => s.isRunning);
  const startSession     = useAppStore(s => s.startSession);
  const markRunning      = useAppStore(s => s.markRunning);
  const completeSession  = useAppStore(s => s.completeSession);
  const failSession      = useAppStore(s => s.failSession);
  const setSessionPlan   = useAppStore(s => s.setSessionPlan);
  const setRunningStep   = useAppStore(s => s.setRunningStep);
  const appendStreamStep = useAppStore(s => s.appendStreamStep);
  const clearCurrent     = useAppStore(s => s.clearCurrent);
  const retrySession     = useAppStore(s => s.retrySession);
  const refreshUser      = useAuthStore(s => s.refreshUser);

  useEffect(() => {
    dbg('lifecycle', 'Workspace mounted');
    return () => { dbg('lifecycle', 'Workspace unmounted'); };
  }, []);

  const pendingConsumed = useRef(false);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const sessionViewRef  = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (cancelStreamRef.current) {
      dbg('lifecycle', 'cancel stream on unmount');
      cancelStreamRef.current();
      cancelStreamRef.current = null;
      const { currentSession: s, failSession: fail } = useAppStore.getState();
      if (s && (s.status === 'streaming' || s.status === 'running' || s.status === 'planning')) {
        dbg('store', `failSession on unmount: id=${s.id} status=${s.status}`);
        fail(s.id, 'Task interrupted by navigation');
      }
    }
  }, []);

  // Auto-scroll to latest step during streaming, but only when the user is
  // already near the bottom so we don't interrupt deliberate scrolling up.
  useEffect(() => {
    if (!isRunning) return;
    const el = sessionViewRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [currentSession?.steps.length, isRunning]);

  const executeTask = useCallback((task: string, mode: RunMode, sessionId: string) => {
    dbg('lifecycle', `executeTask start`, { mode, sessionId, task: task.slice(0, 60) });
    markRunning(sessionId);

    if (mode === 'image') {
      agentApi.run('image', task)
        .then(resp => {
          if (!resp.success) throw new Error(resp.error ?? 'Image generation failed');
          completeSession(sessionId, {
            success:     true,
            finalAnswer: resp.result?.content ?? '',
            durationMs:  resp.durationMs,
            usage:       resp.usage,
          });
          refreshUser();
          toast.success(`Image generated in ${(resp.durationMs / 1000).toFixed(1)}s`);
        })
        .catch(err => {
          const raw = err instanceof Error ? err.message : 'Image generation failed';
          const msg = raw.length > 300 ? raw.slice(0, 300) + '…' : raw;
          dbg('error', `image error: ${msg}`);
          failSession(sessionId, msg);
          toast.error(msg.length > 80 ? msg.slice(0, 80) + '…' : msg);
        });
      return;
    }

    // ── Gemini direct path ─────────────────────────────────────────────────────
    // When the user has a Gemini key in Settings, call the Gemini API directly
    // from the browser. No backend needed — works instantly, no deployment required.
    if (getGeminiKey()) {
      dbg('lifecycle', 'using Gemini direct (browser→Gemini)', { sessionId });
      const cancel = streamGeminiDirect(task, {
        onStep: step => {
          dbg('store', `gemini appendStreamStep ${step.stepId}`, { status: step.status });
          appendStreamStep(sessionId, step);
        },
        onDone: result => {
          dbg('store', 'gemini completeSession', { sessionId, durationMs: result.durationMs });
          cancelStreamRef.current = null;
          completeSession(sessionId, result);
          refreshUser();
          const dur = result.durationMs ? ` in ${(result.durationMs / 1000).toFixed(1)}s` : '';
          toast.success(`Task completed${dur}`);
        },
        onError: error => {
          dbg('error', `gemini onError: ${error}`, { sessionId });
          cancelStreamRef.current = null;
          const msg = error.length > 300 ? error.slice(0, 300) + '…' : error;
          failSession(sessionId, msg);
          toast.error(msg.length > 80 ? msg.slice(0, 80) + '…' : msg);
        },
      });
      cancelStreamRef.current = cancel;
      return;
    }

    // ── Backend streaming path (fallback when no Gemini key) ──────────────────
    const streamMode = mode as 'react' | 'multi' | 'orchestrate';
    const body = mode === 'react' ? { task, maxSteps: 5 } : { task };

    const cancel = streamAgent(streamMode, body, {
      onPlan: plan => {
        dbg('store', `setSessionPlan`, { steps: plan.length, sessionId });
        setSessionPlan(sessionId, plan);
      },
      onStepStart: (payload: StepStartPayload) => {
        dbg('store', `setRunningStep #${payload.stepNum}`, { action: payload.action, sessionId });
        setRunningStep(sessionId, payload.stepNum, payload.thought, payload.action, payload.actionInput);
      },
      onStep: rawStep => {
        const step = 'thought' in rawStep
          ? normalizeReActStep(rawStep as ReActStep)
          : normalizeStepResult(rawStep as StepResult);
        dbg('store', `appendStreamStep ${step.stepId}`, { status: step.status, sessionId });
        appendStreamStep(sessionId, step);
      },
      onDone: result => {
        dbg('store', `completeSession`, {
          sessionId,
          success:   result.success,
          stoppedBy: result.stoppedBy,
          steps:     result.steps?.length ?? result.stepResults?.length ?? 0,
        });
        cancelStreamRef.current = null;
        completeSession(sessionId, result);
        refreshUser();
        const dur = result.durationMs ? ` in ${(result.durationMs / 1000).toFixed(1)}s` : '';
        toast.success(`Task completed${dur}`);
      },
      onError: error => {
        dbg('error', `stream onError: ${error}`, { sessionId });
        cancelStreamRef.current = null;
        const msg = error.length > 300 ? error.slice(0, 300) + '…' : error;
        failSession(sessionId, msg);
        toast.error(msg.length > 80 ? msg.slice(0, 80) + '…' : msg);
      },
    });

    cancelStreamRef.current = cancel;
  }, [markRunning, completeSession, failSession, setSessionPlan, setRunningStep, appendStreamStep, refreshUser]);

  // Auto-execute a pending task set by the Workflows page.
  // Placed after executeTask so the reference is defined. Runs once per mount.
  useEffect(() => {
    if (pendingConsumed.current) return;
    const state = useAppStore.getState();
    if (state.pendingTask && !state.isRunning) {
      pendingConsumed.current = true;
      const { task, mode, workflowLabel } = state.pendingTask;
      state.clearPendingTask();
      const sessionId = state.startSession(task, mode, workflowLabel);
      executeTask(task, mode, sessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeTask]);

  const handleRun = useCallback((task: string, mode: RunMode, workflowLabel?: string) => {
    if (isRunning) return;
    dbg('lifecycle', 'handleRun', { mode, task: task.slice(0, 60) });
    const sessionId = startSession(task, mode, workflowLabel);
    executeTask(task, mode, sessionId);
  }, [isRunning, startSession, executeTask]);

  const handleRetry = useCallback(() => {
    if (!currentSession || isRunning) return;
    const { task, mode, id } = currentSession;
    dbg('lifecycle', 'handleRetry', { id, mode });
    retrySession(id);
    executeTask(task, mode, id);
  }, [currentSession, isRunning, retrySession, executeTask]);

  const handleCancel = useCallback(() => {
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    const { currentSession: s } = useAppStore.getState();
    if (s && (s.status === 'streaming' || s.status === 'running' || s.status === 'planning')) {
      dbg('lifecycle', `handleCancel id=${s.id}`);
      failSession(s.id, 'Cancelled by user');
      toast.info('Task cancelled');
    }
  }, [failSession]);

  const modeData = MODE_INFO[runMode];
  const ModeIcon = modeData.icon;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0 h-full">

        <AnimatePresence mode="sync" initial={false}>
          {!currentSession ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex flex-col overflow-y-auto"
            >
              <div className="max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-7">
                {/* Hero */}
                <div className="text-center pt-4">
                  <div className="w-16 h-16 rounded-2xl bg-[var(--color-nexus-accent-3)] border border-[rgba(0,229,160,0.2)] flex items-center justify-center mx-auto mb-5 glow-accent animate-float">
                    <Terminal size={28} className="text-[var(--color-nexus-accent)]" />
                  </div>
                  <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                    Operations workspace
                  </h2>
                  <p className="text-sm text-[var(--color-text-muted)] max-w-sm mx-auto">
                    Select a workflow pipeline or describe your task. Nexus orchestrates specialized agents to complete it end-to-end.
                  </p>
                </div>

                {/* Active mode */}
                <div className="surface rounded-2xl p-4 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-nexus-elevated)] flex items-center justify-center shrink-0">
                    <ModeIcon size={18} style={{ color: modeData.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{modeData.label} mode</span>
                      <Badge variant="accent" size="sm">active</Badge>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{modeData.desc}</p>
                  </div>
                </div>

                {/* Workflow pipelines */}
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">Workflow pipelines</p>
                  {WORKFLOW_PIPELINES.map(pipeline => {
                    const PipeIcon = pipeline.icon;
                    return (
                      <div key={pipeline.id} className="surface rounded-2xl overflow-hidden">
                        {/* Pipeline header */}
                        <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--color-nexus-border)]">
                          <div className="w-7 h-7 rounded-lg bg-[var(--color-nexus-elevated)] flex items-center justify-center shrink-0">
                            <PipeIcon size={14} className={`text-[var(--color-nexus-${pipeline.color})]`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-semibold text-[var(--color-text-primary)]">{pipeline.label}</span>
                            <p className="text-[10px] text-[var(--color-text-muted)] leading-tight mt-0.5">{pipeline.desc}</p>
                          </div>
                          {/* Stage flow */}
                          <div className="hidden sm:flex items-center gap-1 shrink-0">
                            {pipeline.stages.map((stage, i) => (
                              <span key={stage} className="flex items-center gap-1">
                                <span className="text-[10px] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded bg-[var(--color-nexus-elevated)]">{stage}</span>
                                {i < pipeline.stages.length - 1 && (
                                  <ArrowRight size={9} className="text-[var(--color-text-muted)] opacity-40" />
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                        {/* Tasks */}
                        <div className="divide-y divide-[var(--color-nexus-border)]">
                          {pipeline.tasks.map((task, i) => (
                            <button
                              key={i}
                              onClick={() => handleRun(task, pipeline.mode, pipeline.label)}
                              disabled={isRunning}
                              className="w-full text-left px-4 py-3 hover:bg-[var(--color-glass-hover)] transition-colors group flex items-start gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <ChevronRight size={12} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-nexus-accent)] transition-colors mt-0.5 shrink-0" />
                              <span className="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors leading-relaxed flex-1">
                                {task}
                              </span>
                              <Badge variant="outline" size="sm" className="shrink-0 ml-1">{pipeline.mode}</Badge>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Custom task hint */}
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-[var(--color-nexus-border)] text-center justify-center">
                  <Sparkles size={13} className="text-[var(--color-text-muted)] shrink-0" />
                  <p className="text-xs text-[var(--color-text-muted)]">Or type any custom task below — the agent will handle it end-to-end.</p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="session"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 overflow-y-auto"
              ref={sessionViewRef}
            >
              <div className="max-w-3xl mx-auto px-4 py-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    {currentSession.workflowLabel && (
                      <Badge variant="accent" size="sm">{currentSession.workflowLabel}</Badge>
                    )}
                    <span>Session</span>
                    <code className="bg-[var(--color-nexus-elevated)] px-1.5 py-0.5 rounded font-mono text-[10px]">
                      {currentSession.id.slice(0, 13)}
                    </code>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {new Date(currentSession.startedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {currentSession.retryCount ? (
                      <Badge variant="amber" size="sm">retry #{currentSession.retryCount}</Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {isRunning && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancel}
                        className="gap-1.5 text-[var(--color-nexus-red)] hover:text-[var(--color-nexus-red)] hover:bg-[rgba(239,68,68,0.08)]"
                      >
                        <Square size={12} />
                        Cancel
                      </Button>
                    )}
                    {!isRunning && currentSession.status === 'error' && (
                      <Button variant="ghost" size="sm" onClick={handleRetry} className="gap-1.5">
                        <RefreshCw size={13} />
                        Retry
                      </Button>
                    )}
                    {!isRunning && (
                      <Button variant="ghost" size="sm" onClick={clearCurrent} className="gap-1.5">
                        <RotateCcw size={13} />
                        New task
                      </Button>
                    )}
                  </div>
                </div>
                <ExecutionTimeline session={currentSession} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input bar */}
        <div className="shrink-0 border-t border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] p-4">
          <div className="max-w-3xl mx-auto">
            <AgentInput
              onSubmit={(task, mode) => handleRun(task, mode)}
              isRunning={isRunning}
              mode={runMode}
              onModeChange={setRunMode}
            />
            <p className="text-center text-[10px] text-[var(--color-text-muted)] mt-2">
              Nexus AI may make mistakes. Verify outputs for production use.
            </p>
          </div>
        </div>
      </div>

      <DebugPanel />
    </div>
  );
}
