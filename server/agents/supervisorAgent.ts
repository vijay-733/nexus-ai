import { modelRouter } from '../router/modelRouter.js';
import { recoveryEngine } from '../recovery/recoveryEngine.js';
import { healthMonitor } from '../health/healthMonitor.js';
import { globalEventBus } from '../events/eventBus.js';
import type { ModelMessage } from '../router/types.js';

export interface SupervisorValidation {
  valid:            boolean;
  score:            number;
  issues:           string[];
  suggestions:      string[];
  requiresRevision: boolean;
}

export interface SupervisorDecision {
  action:     'approve' | 'revise' | 'escalate' | 'terminate';
  reason:     string;
  validation: SupervisorValidation;
  recovery?:  { triggered: boolean; succeeded: boolean };
}

const SYSTEM_PROMPT = `You are a Supervisor Agent for quality control. Evaluate agent outputs strictly.
Respond ONLY with valid JSON — no markdown, no explanation:
{"valid":boolean,"score":number,"issues":string[],"suggestions":string[],"requiresRevision":boolean}
Score 0-100: 80+ = approve, 50-79 = revise, <50 = escalate.`;

const emit = globalEventBus.createEmitter('supervisor-agent');

export async function runSupervisorAgent(
  originalTask: string,
  agentOutput:  string,
  opts?: { taskId?: string; userId?: string; autoRecover?: boolean }
): Promise<SupervisorDecision> {
  emit('AGENT_STARTED', { role: 'supervisor' }, { taskId: opts?.taskId, userId: opts?.userId });

  const messages: ModelMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role:    'user',
      content: `TASK:\n${originalTask}\n\nOUTPUT TO VALIDATE:\n${agentOutput}`,
    },
  ];

  let validation: SupervisorValidation;
  try {
    const res   = await modelRouter.complete({ messages, maxTokens: 400, temperature: 0.1 });
    const match = res.content.match(/\{[\s\S]*\}/);
    validation  = match
      ? (JSON.parse(match[0]) as SupervisorValidation)
      : { valid: true, score: 70, issues: [], suggestions: [], requiresRevision: false };
  } catch {
    validation = { valid: true, score: 70, issues: ['Validation unavailable'], suggestions: [], requiresRevision: false };
  }

  const systemDegraded = healthMonitor.getReport().status !== 'healthy';

  let action: SupervisorDecision['action'];
  let reason: string;

  if (validation.score >= 80) {
    action = 'approve';
    reason = `Quality score ${validation.score}/100 — approved`;
  } else if (validation.score >= 50 && !systemDegraded) {
    action = 'revise';
    reason = `Quality score ${validation.score}/100 — needs revision: ${validation.issues.slice(0, 2).join('; ')}`;
  } else if (systemDegraded || validation.score < 30) {
    action = 'escalate';
    reason = `Score ${validation.score}/100${systemDegraded ? ' + system degraded' : ''} — escalating`;
  } else {
    action = 'terminate';
    reason = `Score ${validation.score}/100 below minimum threshold`;
  }

  const decision: SupervisorDecision = { action, reason, validation };

  if (opts?.autoRecover && opts.taskId && (action === 'revise' || action === 'escalate')) {
    const succeeded = await recoveryEngine.recover(opts.taskId, reason);
    decision.recovery = { triggered: true, succeeded };
  }

  emit('AGENT_COMPLETED', { action, score: validation.score }, {
    taskId: opts?.taskId, userId: opts?.userId,
  });

  return decision;
}
