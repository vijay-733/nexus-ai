import { randomUUID }        from 'crypto';
import { globalEventBus }    from '../events/eventBus.js';
import { createPlan }        from './planner.js';
import { buildSystemPrompt } from '../context/promptTemplates.js';
import { remember, recall }  from '../memory/memoryManager.js';
import { logger }            from '../utils/logger.js';
import type { PlanStep }     from '../memory/sharedMemory.js';

const emit = globalEventBus.createEmitter('planner-agent');

export interface ExecutionPlan {
  id:          string;
  taskId:      string;
  userId:      string;
  steps:       PlanStep[];
  createdAt:   number;
  refinements: number;
  metadata:    Record<string, unknown>;
}

export interface PlannerInput {
  task:       string;
  userId:     string;
  taskId?:    string;
  context?:   string;
  maxSteps?:  number;
}

export class PlannerAgent {
  private static readonly MAX_REFINEMENTS = 3;

  async createPlan(input: PlannerInput): Promise<ExecutionPlan> {
    const taskId = input.taskId ?? randomUUID();
    const t0     = Date.now();

    logger.info('planner-agent', `Creating plan task="${input.task.slice(0, 80)}" user=${input.userId}`);
    emit('PLAN_CREATED', { taskId, userId: input.userId, task: input.task }, { taskId, userId: input.userId });

    // Inject context into task if provided
    const enrichedTask = input.context
      ? `${input.task}\n\nAdditional context:\n${input.context}`
      : input.task;

    const steps = await createPlan(enrichedTask);
    const cappedSteps = steps.slice(0, input.maxSteps ?? 5);

    const plan: ExecutionPlan = {
      id:          randomUUID(),
      taskId,
      userId:      input.userId,
      steps:       cappedSteps,
      createdAt:   Date.now(),
      refinements: 0,
      metadata:    { originalTask: input.task, durationMs: Date.now() - t0 },
    };

    // Persist plan to memory
    await remember('plans', plan.id, plan, {
      userId: input.userId,
      taskId,
      tags: ['plan', 'execution'],
    });

    logger.info('planner-agent', `Plan created id=${plan.id} steps=${plan.steps.length} dur=${Date.now()-t0}ms`);
    return plan;
  }

  async refinePlan(planId: string, feedback: string, userId: string): Promise<ExecutionPlan> {
    const existing = await recall('plans', planId) as ExecutionPlan | null;
    if (!existing) throw new Error(`Plan ${planId} not found`);

    if (existing.refinements >= PlannerAgent.MAX_REFINEMENTS) {
      throw new Error(`Maximum refinements (${PlannerAgent.MAX_REFINEMENTS}) reached for plan ${planId}`);
    }

    const refinementTask = `
Original task: ${existing.metadata['originalTask']}
Current plan has ${existing.steps.length} steps: ${existing.steps.map(s => `[${s.id}:${s.type}] ${s.task.slice(0, 60)}`).join(', ')}

Supervisor feedback: ${feedback}

Please revise the plan to address this feedback.`;

    const newSteps = await createPlan(refinementTask);

    const refined: ExecutionPlan = {
      ...existing,
      steps:       newSteps.slice(0, 5),
      refinements: existing.refinements + 1,
      metadata:    { ...existing.metadata, lastFeedback: feedback, refinedAt: Date.now() },
    };

    await remember('plans', planId, refined, { userId, tags: ['plan', 'refined'] });

    logger.info('planner-agent', `Refined plan id=${planId} refinement=${refined.refinements}`);
    emit('PLAN_STEP_STARTED', { planId, refinement: refined.refinements }, { userId });
    return refined;
  }

  getSystemPrompt(userId: string, taskId: string): string {
    return buildSystemPrompt('planner', { userId, taskId });
  }
}

export const plannerAgent = new PlannerAgent();
