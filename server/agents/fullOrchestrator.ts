// Full 8-agent production orchestrator.
// Flow: GovernanceAgent → PlannerAgent → Workers (Text/Image) →
//       RecoveryAgent (checkpoints) → SupervisorAgent → MemoryAgent → output.

import { randomUUID }            from 'crypto';
import { globalEventBus }        from '../events/eventBus.js';
import { plannerAgent }          from './plannerAgent.js';
import { memoryAgent }           from './memoryAgent.js';
import { recoveryAgent }         from './recoveryAgent.js';
import { governanceAgent }       from './governanceAgent.js';
import { runTextAgent }          from './workers/textAgent.js';
import { runImageAgent }         from './workers/imageAgent.js';
import { sharedMemory }          from '../memory/sharedMemory.js';
import { checkCredits, recordUsage } from '../services/usageTracker.js';
import { resolveProviders }      from '../services/modelRouter.js';
import { store }                 from '../utils/store.js';
import { logger }                from '../utils/logger.js';
import type { PlanName }         from '../utils/config.js';
import type { PlanStep }         from '../memory/sharedMemory.js';
import type { Role }             from '../governance/permissions.js';

const emit = globalEventBus.createEmitter('full-orchestrator');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrchestratorCallbacks {
  onPlan?: (plan: PlanStep[]) => void;
  onStep?: (result: StepResult) => void;
}

export interface OrchestratorInput {
  userId:      string;
  userRole?:   Role;
  task:        string;
  sessionId?:  string;
  taskSignal?: AbortSignal;
  callbacks?:  OrchestratorCallbacks;
  options?: {
    style?:       string;
    aspectRatio?: string;
    seed?:        number;
    maxSteps?:    number;
    supervise?:   boolean;
  };
}

export interface StepResult {
  stepId:     string;
  type:       PlanStep['type'];
  task:       string;
  content:    string;
  provider:   string;
  status:     'done' | 'failed' | 'skipped';
  durationMs: number;
  error?:     string;
}

export interface OrchestratorResult {
  success:         boolean;
  sessionId:       string;
  taskId:          string;
  originalTask:    string;
  plan:            PlanStep[];
  stepResults:     StepResult[];
  finalAnswer:     string;
  supervisorScore?: number;
  completedSteps:  number;
  totalSteps:      number;
  durationMs:      number;
  stoppedBy:       'complete' | 'maxSteps' | 'timeout' | 'governance' | 'error' | 'recovery';
  error?:          string;
  usage: {
    creditsUsed:      number;
    creditsRemaining: number;
    plan:             string;
  };
}

const TOTAL_TIMEOUT_MS = 65_000;   // must complete before Cloudflare free tunnel's ~80s kill
const MAX_PLAN_STEPS   = 5;

// ── Wave builder (topological sort) ──────────────────────────────────────────

function buildWaves(steps: PlanStep[]): PlanStep[][] {
  const waves: PlanStep[][] = [];
  const done    = new Set<string>();
  let remaining = [...steps];

  while (remaining.length > 0) {
    const ready = remaining.filter(s => s.dependsOn.every(id => done.has(id)));
    if (!ready.length) {
      logger.warn('full-orchestrator', 'Circular dependency — forcing next step');
      ready.push(remaining[0]);
    }
    waves.push(ready);
    ready.forEach(s => done.add(s.id));
    remaining = remaining.filter(s => !done.has(s.id));
  }
  return waves;
}

// ── Supervisor check ──────────────────────────────────────────────────────────

async function supervisorCheck(
  task: string,
  results: StepResult[]
): Promise<{ score: number; decision: string; reason: string }> {
  const summary = results
    .filter(r => r.status === 'done')
    .map(r => `Step: ${r.task}\nOutput: ${r.content.slice(0, 500)}`)
    .join('\n\n---\n\n');

  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  try {
    if (!openaiKey) {
      return { score: 70, decision: 'approve', reason: 'Auto-approved (no supervisor LLM)' };
    }
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model:      'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          {
            role:    'system',
            content: 'You are a quality supervisor. Evaluate the task output. Return ONLY valid JSON: {"decision":"approve|revise|escalate","score":0-100,"reason":"..."}',
          },
          { role: 'user', content: `Task: ${task}\n\nOutputs:\n${summary}`.slice(0, 3_000) },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const d = await r.json() as { choices?: Array<{ message: { content: string } }> };
    const raw = d.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
    return {
      score:    Number(parsed.score ?? 70),
      decision: String(parsed.decision ?? 'approve'),
      reason:   String(parsed.reason   ?? ''),
    };
  } catch {
    return { score: 70, decision: 'approve', reason: 'Supervisor check failed — auto-approved' };
  }
}

// ── Final answer assembly ─────────────────────────────────────────────────────

function assembleAnswer(results: StepResult[]): string {
  const done = results.filter(r => r.status === 'done');
  if (done.length === 0) return 'No output produced.';

  if (done.length === 1) {
    const r = done[0];
    return r.type === 'image'
      ? r.content  // raw base64/URL for image rendering
      : r.content.slice(0, 4_000);
  }

  // Multi-step: label each section
  const parts = done.map((r, i) => {
    if (r.type === 'image') return r.content;
    const heading = `## Step ${i + 1}: ${r.task.slice(0, 80)}`;
    return `${heading}\n\n${r.content.slice(0, 2_000)}`;
  });
  return parts.join('\n\n---\n\n');
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function runFullOrchestration(input: OrchestratorInput): Promise<OrchestratorResult> {
  const t0        = Date.now();
  const taskId    = randomUUID();
  const sessionId = input.sessionId ?? randomUUID();
  const userRole  = input.userRole ?? 'user';
  let   credits   = 0;
  const results:  StepResult[] = [];
  let   stoppedBy: OrchestratorResult['stoppedBy'] = 'complete';

  logger.info('full-orchestrator', `START taskId=${taskId} user=${input.userId} task="${input.task.slice(0, 80)}"`);
  emit('TASK_CREATED',   { taskId, userId: input.userId, task: input.task }, { taskId, userId: input.userId });
  emit('AGENT_STARTED',  { taskId, userId: input.userId, task: input.task, mode: 'orchestrate' }, { taskId, userId: input.userId });

  // ── 1. Governance pre-flight ──────────────────────────────────────────────
  const govCheck = await governanceAgent.validateAgentOp(input.userId, userRole, 'agent:run');
  if (!govCheck.allowed) {
    const u = store.users.findById(input.userId)!;
    return {
      success: false, sessionId, taskId, originalTask: input.task,
      plan: [], stepResults: [], finalAnswer: '',
      completedSteps: 0, totalSteps: 0,
      durationMs: Date.now() - t0, stoppedBy: 'governance', error: govCheck.reason,
      usage: { creditsUsed: 0, creditsRemaining: u.credits, plan: u.plan },
    };
  }

  // ── 2. Create execution plan ──────────────────────────────────────────────
  let plan: PlanStep[];
  try {
    const execPlan = await plannerAgent.createPlan({
      task:     input.task,
      userId:   input.userId,
      taskId,
      maxSteps: input.options?.maxSteps ?? MAX_PLAN_STEPS,
    });
    plan = execPlan.steps;
    logger.info('full-orchestrator', `Plan: ${plan.length} steps [${plan.map(s => `${s.id}:${s.type}`).join(',')}]`);
    input.callbacks?.onPlan?.(plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Planning failed';
    logger.error('full-orchestrator', `Planning error: ${msg}`);
    await recoveryAgent.planRecovery(taskId, msg, 0);
    const u = store.users.findById(input.userId)!;
    return {
      success: false, sessionId, taskId, originalTask: input.task,
      plan: [], stepResults: [], finalAnswer: '',
      completedSteps: 0, totalSteps: 0,
      durationMs: Date.now() - t0, stoppedBy: 'error', error: msg,
      usage: { creditsUsed: 0, creditsRemaining: u.credits, plan: u.plan },
    };
  }

  // ── 3. Init shared memory session ────────────────────────────────────────
  sharedMemory.create({
    id: sessionId, userId: input.userId, originalTask: input.task,
    plan, outputs: {}, context: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  // ── 4. Initial checkpoint ─────────────────────────────────────────────────
  await recoveryAgent.checkpoint(taskId, 0, { plan, sessionId, userId: input.userId });

  // ── 5. Execute waves ──────────────────────────────────────────────────────
  const waves = buildWaves(plan);
  const user  = store.users.findById(input.userId)!;
  const prov  = resolveProviders(user.plan as PlanName);

  // Combined deadline: hard server timeout + optional caller signal
  const timeoutSignal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const loopSignal    = input.taskSignal
    ? AbortSignal.any([input.taskSignal, timeoutSignal])
    : timeoutSignal;

  outer:
  for (const [wi, wave] of waves.entries()) {
    if (loopSignal.aborted) { stoppedBy = 'timeout'; break outer; }
    logger.info('full-orchestrator', `Wave ${wi + 1}/${waves.length}: [${wave.map(s => s.id).join(',')}]`);

    // Run all steps in a wave in parallel
    const waveSettled = await Promise.allSettled(
      wave.map(async (step): Promise<StepResult> => {
        if (loopSignal.aborted) {
          return { stepId: step.id, type: step.type, task: step.task,
            content: '', provider: 'none', status: 'skipped', durationMs: 0, error: 'timeout' };
        }

        // Per-step governance
        const toolName = step.type === 'image' ? 'image-generation' : 'text-generation';
        const stepGov  = await governanceAgent.validateToolCall(input.userId, userRole, toolName);
        if (!stepGov.allowed) {
          return { stepId: step.id, type: step.type, task: step.task,
            content: '', provider: 'none', status: 'skipped', durationMs: 0, error: stepGov.reason };
        }

        // Credit check
        const creditCheck = checkCredits(input.userId, toolName, true);
        if (!creditCheck.allowed) {
          return { stepId: step.id, type: step.type, task: step.task,
            content: '', provider: 'none', status: 'failed', durationMs: 0, error: creditCheck.reason };
        }

        sharedMemory.setStepStatus(sessionId, step.id, 'running');
        const context = sharedMemory.buildContext(sessionId, step.dependsOn);

        if (step.type === 'image') {
          const out = await runImageAgent({
            stepId: step.id, task: step.task, context, userId: input.userId,
            style: input.options?.style, aspectRatio: input.options?.aspectRatio, seed: input.options?.seed,
          });
          const rec = recordUsage(input.userId, 'image-generation', out.provider,
            out.error ? 'failed' : 'success', out.durationMs, step.task);
          if (!out.error) credits += rec.creditsUsed;
          return {
            stepId: step.id, type: 'image', task: step.task,
            content: out.content, provider: out.provider,
            status: out.error ? 'failed' : 'done',
            durationMs: out.durationMs, error: out.error,
          };
        } else {
          const out = await runTextAgent({
            stepId: step.id, task: step.task, context, provider: prov.text,
          });
          const rec = recordUsage(input.userId, 'text-generation', out.provider,
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

    // Collect + persist wave results
    for (const [idx, settled] of waveSettled.entries()) {
      const step       = wave[idx];
      const stepResult = settled.status === 'fulfilled'
        ? settled.value
        : { stepId: step.id, type: step.type as PlanStep['type'], task: step.task,
            content: '', provider: 'none', status: 'failed' as const,
            durationMs: 0, error: String((settled as PromiseRejectedResult).reason) };

      results.push(stepResult);
      sharedMemory.saveOutput(sessionId, {
        stepId: step.id, type: step.type, content: stepResult.content.slice(0, 2_000),
        provider: stepResult.provider, durationMs: stepResult.durationMs,
        timestamp: Date.now(), error: stepResult.error,
      });
      sharedMemory.setStepStatus(sessionId, step.id, stepResult.status === 'done' ? 'done' : 'failed');
      // Stream step result to connected SSE clients immediately
      input.callbacks?.onStep?.(stepResult);
    }

    // Checkpoint after each wave
    await recoveryAgent.checkpoint(taskId, wi + 1, { results, plan, sessionId, userId: input.userId });

    if (loopSignal.aborted) {
      stoppedBy = 'timeout';
      break outer;
    }
  }

  // ── 6. Supervisor validation ────────────────────────────────────────────────
  let supervisorScore: number | undefined;
  if (input.options?.supervise !== false && results.some(r => r.status === 'done')) {
    try {
      const sv = await supervisorCheck(input.task, results);
      supervisorScore = sv.score;
      logger.info('full-orchestrator', `Supervisor: score=${sv.score} decision=${sv.decision}`);
      if (sv.decision === 'revise' && sv.score < 50) {
        await recoveryAgent.planRecovery(taskId, `Low quality score: ${sv.score}. ${sv.reason}`, 0);
      }
    } catch (err) {
      logger.warn('full-orchestrator', `Supervisor error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 7. Memory consolidation ──────────────────────────────────────────────
  await memoryAgent.store('sessions', sessionId, {
    taskId, userId: input.userId, task: input.task,
    completedAt: Date.now(), stepCount: results.length,
  }, { userId: input.userId, taskId, tags: ['session', 'completed'] });

  // ── 8. Final assembly ─────────────────────────────────────────────────────
  const finalAnswer    = assembleAnswer(results);
  const completedSteps = results.filter(r => r.status === 'done').length;
  const durationMs     = Date.now() - t0;
  const updUser        = store.users.findById(input.userId)!;

  // Synthesize error message when all steps failed
  const firstStepError = results.find(r => r.error)?.error;
  const failureError   = completedSteps === 0
    ? (firstStepError
        ? `AI provider failed: ${firstStepError}. Add an OPENAI_API_KEY or GEMINI_API_KEY to the server .env for reliable results.`
        : 'All execution steps failed. The AI provider may be unavailable — add OPENAI_API_KEY or GEMINI_API_KEY to .env and restart the server.')
    : undefined;

  emit('TASK_COMPLETED', { taskId, sessionId, completedSteps, durationMs, credits }, { taskId, userId: input.userId });
  if (completedSteps > 0) {
    emit('AGENT_COMPLETED', { taskId, sessionId, completedSteps, totalSteps: plan.length, durationMs }, { taskId, userId: input.userId });
  } else {
    emit('AGENT_FAILED', { taskId, sessionId, durationMs, error: failureError }, { taskId, userId: input.userId });
  }
  logger.info('full-orchestrator', `DONE taskId=${taskId} steps=${completedSteps}/${plan.length} dur=${durationMs}ms`);

  return {
    success:         completedSteps > 0,
    sessionId, taskId,
    originalTask:    input.task,
    plan,
    stepResults:     results,
    finalAnswer,
    supervisorScore,
    completedSteps,
    totalSteps:      plan.length,
    durationMs,
    stoppedBy:       completedSteps === 0 && stoppedBy === 'complete' ? 'error' : stoppedBy,
    error:           failureError,
    usage: {
      creditsUsed:      credits,
      creditsRemaining: updUser.credits,
      plan:             updUser.plan,
    },
  };
}
