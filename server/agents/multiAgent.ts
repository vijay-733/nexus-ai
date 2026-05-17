// Multi-Agent Orchestrator
//
// Flow:
//   1. Create session in sharedMemory
//   2. Call Planner  → PlanStep[]
//   3. Build waves   → topological sort resolving dependsOn edges
//   4. Execute waves → TextAgent | ImageAgent (parallel within each wave)
//   5. Collect StepResult[], update sharedMemory after every step
//   6. Assemble final answer, record usage, return MultiAgentResult
//
// Safety: 120s total timeout, max 5 plan steps, credit check per step.
// taskSignal: caller (engine) can inject an overall deadline signal.

import { randomUUID }                   from 'crypto';
import { globalEventBus }               from '../events/eventBus.js';
import { createPlan }                   from './planner.js';
import { runTextAgent }                 from './workers/textAgent.js';
import { runImageAgent }                from './workers/imageAgent.js';
import {
  sharedMemory,
  type PlanStep,
  type StepOutput,
  type AgentSession,
}                                       from '../memory/sharedMemory.js';
import { checkCredits, recordUsage }    from '../services/usageTracker.js';
import { resolveProviders }             from '../services/modelRouter.js';
import { store }                        from '../utils/store.js';
import { logger }                       from '../utils/logger.js';
import type { PlanName }                from '../utils/config.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface StepResult {
  stepId:     string;
  type:       'text' | 'image';
  task:       string;
  content:    string;
  provider:   string;
  status:     'done' | 'failed';
  durationMs: number;
  error?:     string;
}

export interface MultiAgentResult {
  success:        boolean;
  sessionId:      string;
  originalTask:   string;
  plan:           PlanStep[];
  stepResults:    StepResult[];
  finalAnswer:    string;
  totalSteps:     number;
  completedSteps: number;
  durationMs:     number;
  stoppedBy:      'complete' | 'maxSteps' | 'timeout' | 'creditBlock' | 'error';
  error?:         string;
  usage: {
    creditsUsed:      number;
    creditsRemaining: number;
    plan:             string;
  };
}

export interface MultiAgentOptions {
  style?:       string;
  aspectRatio?: string;
  seed?:        number;
}

export interface MultiAgentCallbacks {
  onPlan?: (plan: PlanStep[]) => void;
  onStep?: (result: StepResult) => void;
}

const TOTAL_TIMEOUT_MS = 65_000;   // must complete before Cloudflare free tunnel's ~80s kill
const MAX_PLAN_STEPS   = 5;

const emit = globalEventBus.createEmitter('multi-agent');

// ── Topological wave builder ──────────────────────────────────────────────────

function buildWaves(steps: PlanStep[]): PlanStep[][] {
  const waves:     PlanStep[][] = [];
  const completed  = new Set<string>();
  let   remaining  = [...steps];

  while (remaining.length > 0) {
    const ready = remaining.filter(s => s.dependsOn.every(id => completed.has(id)));
    if (ready.length === 0) {
      logger.warn('multi-agent', `circular dep detected — forcing step ${remaining[0].id}`);
      ready.push(remaining[0]);
    }
    waves.push(ready);
    ready.forEach(s => completed.add(s.id));
    remaining = remaining.filter(s => !completed.has(s.id));
  }
  return waves;
}

// ── Final answer assembly ─────────────────────────────────────────────────────

function assembleAnswer(results: StepResult[]): string {
  const done = results.filter(r => r.status === 'done');
  if (done.length === 0) return 'No output produced.';

  if (done.length === 1) {
    const r = done[0];
    return r.type === 'image' ? r.content : r.content.slice(0, 8_000);
  }

  const parts = done.map((r, i) => {
    if (r.type === 'image') return r.content;
    const heading = `## Step ${i + 1}: ${r.task.slice(0, 80)}`;
    return `${heading}\n\n${r.content.slice(0, 3_000)}`;
  });
  return parts.join('\n\n---\n\n');
}

// ── Error result builder ──────────────────────────────────────────────────────

function errorResult(
  sessionId: string, userId: string, task: string,
  msg: string, plan: PlanStep[], t0: number,
): MultiAgentResult {
  const u = store.users.findById(userId)!;
  return {
    success: false, sessionId, originalTask: task,
    plan, stepResults: [], finalAnswer: '',
    totalSteps: 0, completedSteps: 0,
    durationMs: Date.now() - t0,
    stoppedBy: 'error', error: msg,
    usage: { creditsUsed: 0, creditsRemaining: u.credits, plan: u.plan },
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runMultiAgent(
  userId:      string,
  task:        string,
  options?:    MultiAgentOptions,
  taskSignal?: AbortSignal,
  callbacks?:  MultiAgentCallbacks,
): Promise<MultiAgentResult> {
  const t0        = Date.now();
  const sessionId = randomUUID();
  let   credits   = 0;
  const results:  StepResult[] = [];
  let   stoppedBy: MultiAgentResult['stoppedBy'] = 'complete';

  // Combine caller's deadline with our own total timeout
  const loopSignal = taskSignal
    ? AbortSignal.any([taskSignal, AbortSignal.timeout(TOTAL_TIMEOUT_MS)])
    : AbortSignal.timeout(TOTAL_TIMEOUT_MS);

  logger.info('multi-agent', `START session=${sessionId} user=${userId} task="${task.slice(0, 80)}"`);
  emit('AGENT_STARTED', { userId, sessionId, task, mode: 'multi' }, { userId });

  // ── 1. Init session ────────────────────────────────────────────────────────
  const session: AgentSession = {
    id: sessionId, userId, originalTask: task,
    plan: [], outputs: {}, context: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  sharedMemory.create(session);

  // ── 2. Plan ────────────────────────────────────────────────────────────────
  let plan: PlanStep[];
  try {
    plan = (await createPlan(task)).slice(0, MAX_PLAN_STEPS);
    sharedMemory.updatePlan(sessionId, plan);
    logger.info('multi-agent', `plan: ${plan.length} step(s) [${plan.map(s => `${s.id}:${s.type}`).join(', ')}]`);
    callbacks?.onPlan?.(plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Planning failed';
    logger.error('multi-agent', `planning error: ${msg}`);
    return errorResult(sessionId, userId, task, msg, [], t0);
  }

  // ── 3. Build execution waves ───────────────────────────────────────────────
  const waves = buildWaves(plan);
  const user  = store.users.findById(userId)!;
  const prov  = resolveProviders(user.plan as PlanName);

  // ── 4. Execute waves (parallel within each wave) ─────────────────────────
  outer:
  for (const [wi, wave] of waves.entries()) {
    if (loopSignal.aborted) { stoppedBy = 'timeout'; break outer; }
    logger.info('multi-agent', `wave ${wi + 1}/${waves.length}: [${wave.map(s => s.id).join(', ')}]`);

    const waveSettled = await Promise.allSettled(
      wave.map(async (step): Promise<StepResult> => {

        if (loopSignal.aborted) {
          return {
            stepId: step.id, type: step.type, task: step.task,
            content: '', provider: 'none', status: 'failed',
            durationMs: 0, error: 'Task deadline exceeded',
          };
        }

        const toolName    = step.type === 'image' ? 'image-generation' : 'text-generation';
        const creditCheck = checkCredits(userId, toolName, true);
        if (!creditCheck.allowed) {
          return {
            stepId: step.id, type: step.type, task: step.task,
            content: '', provider: 'none', status: 'failed',
            durationMs: 0, error: creditCheck.reason,
          };
        }

        sharedMemory.setStepStatus(sessionId, step.id, 'running');
        const context = sharedMemory.buildContext(sessionId, step.dependsOn);

        if (step.type === 'image') {
          const out = await runImageAgent({
            stepId: step.id, task: step.task, context, userId,
            style: options?.style, aspectRatio: options?.aspectRatio, seed: options?.seed,
          });
          recordUsage(userId, 'image-generation', out.provider,
            out.error ? 'failed' : 'success', out.durationMs, step.task);
          return {
            stepId: step.id, type: 'image', task: step.task,
            content: out.content, provider: out.provider,
            status: out.error ? 'failed' : 'done',
            durationMs: out.durationMs, error: out.error,
          };
        } else {
          const out = await runTextAgent({
            stepId: step.id, task: step.task, context, provider: prov.text,
            signal: loopSignal,
          });
          const rec = recordUsage(userId, 'text-generation', out.provider,
            out.error ? 'failed' : 'success', out.durationMs, step.task);
          if (!out.error) credits += rec.creditsUsed;
          return {
            stepId: step.id, type: 'text', task: step.task,
            content: out.content, provider: out.provider,
            status: out.error ? 'failed' : 'done',
            durationMs: out.durationMs, error: out.error,
          };
        }
      })
    );

    for (const [idx, settled] of waveSettled.entries()) {
      const step = wave[idx];
      const stepResult: StepResult = settled.status === 'fulfilled'
        ? settled.value
        : {
            stepId: step.id, type: step.type as 'text' | 'image', task: step.task,
            content: '', provider: 'none', status: 'failed',
            durationMs: 0, error: String((settled as PromiseRejectedResult).reason),
          };

      results.push(stepResult);
      callbacks?.onStep?.(stepResult);

      const output: StepOutput = {
        stepId:     step.id,
        type:       step.type,
        content:    stepResult.content.slice(0, 2_000),
        provider:   stepResult.provider,
        durationMs: stepResult.durationMs,
        timestamp:  Date.now(),
        error:      stepResult.error,
      };
      sharedMemory.saveOutput(sessionId, output);
      sharedMemory.setStepStatus(sessionId, step.id, stepResult.status === 'done' ? 'done' : 'failed');

      logger.info('multi-agent', `[${step.id}] ${stepResult.status} dur=${stepResult.durationMs}ms`);
    }

    if (loopSignal.aborted) { stoppedBy = 'timeout'; break outer; }
  }

  // ── 5. Assemble result ────────────────────────────────────────────────────
  const finalAnswer    = assembleAnswer(results);
  const completedSteps = results.filter(r => r.status === 'done').length;
  const durationMs     = Date.now() - t0;
  const updUser        = store.users.findById(userId)!;

  const firstStepError = results.find(r => r.error)?.error;
  const failureError   = completedSteps === 0
    ? (firstStepError
        ? `AI provider failed: ${firstStepError}. Add OPENAI_API_KEY or GEMINI_API_KEY to .env for reliable results.`
        : 'All execution steps failed. Add OPENAI_API_KEY or GEMINI_API_KEY to .env and restart.')
    : undefined;

  logger.info(
    'multi-agent',
    `DONE session=${sessionId} steps=${results.length} completed=${completedSteps} dur=${durationMs}ms stoppedBy=${stoppedBy}`,
  );
  if (completedSteps > 0) {
    emit('AGENT_COMPLETED', { userId, sessionId, completedSteps, totalSteps: plan.length, durationMs }, { userId });
  } else {
    emit('AGENT_FAILED', { userId, sessionId, durationMs, error: failureError }, { userId });
  }

  return {
    success:        completedSteps > 0,
    sessionId,
    originalTask:   task,
    plan,
    stepResults:    results,
    finalAnswer,
    totalSteps:     plan.length,
    completedSteps,
    durationMs,
    stoppedBy:      completedSteps === 0 && stoppedBy === 'complete' ? 'error' : stoppedBy,
    error:          failureError,
    usage: {
      creditsUsed:      credits,
      creditsRemaining: updUser.credits,
      plan:             updUser.plan,
    },
  };
}
