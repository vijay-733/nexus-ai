// Agent Controller
// Single dispatch point for all agent types.
// Maps a Task's `kind` field to the correct agent function, translates the
// agent's response into a uniform AgentOutput, and normalises all errors.
//
// The optional taskSignal propagates the overall task deadline into every
// agent and LLM call so no sub-task can exceed the engine's hard timeout.

import { runMultiAgent, type MultiAgentOptions } from '../agents/multiAgent.js';
import { runReAct }                               from '../agents/react.js';
import { runAgent }                               from '../agents/orchestrator.js';
import { logger }                                 from '../utils/logger.js';
import type { Task }                              from '../state/taskStore.js';

export interface AgentOutput {
  success:   boolean;
  output:    string;
  data?:     unknown;
  error?:    string;
  credits:   number;
  stepCount: number;
}

export async function dispatchToAgent(
  task:        Task,
  taskSignal?: AbortSignal,
): Promise<AgentOutput> {
  logger.info('agent-ctrl', `dispatch taskId=${task.id} kind=${task.kind} user=${task.userId}`);

  try {
    switch (task.kind) {

      case 'multi': {
        const opts = task.options as MultiAgentOptions | undefined;
        const r    = await runMultiAgent(task.userId, task.input, opts, taskSignal);
        return {
          success:   r.success,
          output:    r.finalAnswer,
          data:      { plan: r.plan, stepResults: r.stepResults, sessionId: r.sessionId, stoppedBy: r.stoppedBy },
          error:     r.error,
          credits:   r.usage.creditsUsed,
          stepCount: r.totalSteps,
        };
      }

      case 'react': {
        const maxSteps = Math.min(Number(task.options?.maxSteps ?? 5), 10);
        const r        = await runReAct(task.userId, task.input, maxSteps, taskSignal);
        return {
          success:   r.success,
          output:    r.finalAnswer,
          data:      { steps: r.steps, stoppedBy: r.stoppedBy },
          error:     r.error,
          credits:   r.usage.creditsUsed,
          stepCount: r.totalSteps,
        };
      }

      case 'single': {
        const agentTask = (task.options?.task as 'image' | 'text' | 'auto' | undefined) ?? 'auto';
        const r = await runAgent({
          userId:  task.userId,
          task:    agentTask,
          prompt:  task.input,
          options: task.options as {
            style?: string; aspectRatio?: string; seed?: number;
            systemPrompt?: string; model?: string;
          } | undefined,
        });
        return {
          success:   r.success,
          output:    r.result?.content ?? '',
          data:      { tool: r.tool, result: r.result, requestId: r.requestId },
          error:     r.error,
          credits:   r.usage.creditsUsed,
          stepCount: 1,
        };
      }

      default: {
        const exhausted: never = task.kind;
        return { success: false, output: '', credits: 0, stepCount: 0, error: `Unknown task kind: ${exhausted}` };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent dispatch failed';
    logger.error('agent-ctrl', `taskId=${task.id} unhandled error: ${msg}`);
    return { success: false, output: '', credits: 0, stepCount: 0, error: msg };
  }
}
