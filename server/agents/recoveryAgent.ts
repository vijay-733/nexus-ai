import { globalEventBus }     from '../events/eventBus.js';
import { recoveryEngine }     from '../recovery/recoveryEngine.js';
import { remember, recall }   from '../memory/memoryManager.js';
import { logger }             from '../utils/logger.js';
import { buildSystemPrompt }  from '../context/promptTemplates.js';

const emit = globalEventBus.createEmitter('recovery-agent');

export interface RecoveryPlan {
  taskId:      string;
  strategy:    'resume' | 'restart' | 'fallback_provider';
  step:        number;
  reason:      string;
  actions:     string[];
  estimatedMs: number;
}

export interface RecoveryResult {
  success:  boolean;
  taskId:   string;
  strategy: string;
  message:  string;
  attempts: number;
}

export class RecoveryAgent {
  async planRecovery(
    taskId: string,
    failureReason: string,
    attemptNumber: number
  ): Promise<RecoveryPlan> {
    let strategy: RecoveryPlan['strategy'];
    let reason: string;
    let actions: string[];
    let step = 0;

    const checkpointData = await recall('checkpoints', `checkpoint-${taskId}`) as { step: number } | null;

    if (checkpointData && attemptNumber === 0) {
      strategy = 'resume';
      step     = checkpointData.step;
      reason   = `Resuming from checkpoint at step ${step}`;
      actions  = [
        `Restore state from checkpoint step=${step}`,
        'Re-validate execution context',
        'Continue execution from checkpoint',
      ];
    } else if (attemptNumber < 2) {
      strategy = 'restart';
      reason   = `Restarting execution (attempt ${attemptNumber + 1})`;
      actions  = [
        'Clear failed execution state',
        'Re-initialize execution context',
        'Restart from step 0',
        `Apply backoff: ${Math.min(1000 * Math.pow(2, attemptNumber), 30_000)}ms`,
      ];
    } else {
      strategy = 'fallback_provider';
      reason   = 'Switching to fallback provider after multiple failures';
      actions  = [
        'Mark primary provider as degraded',
        'Switch to Pollinations free provider',
        'Restart execution with fallback provider',
      ];
    }

    const plan: RecoveryPlan = {
      taskId, strategy, step, reason, actions,
      estimatedMs: strategy === 'resume' ? 5_000 : strategy === 'restart' ? 10_000 : 15_000,
    };

    await remember('recovery', `plan-${taskId}`, plan, { taskId, tags: ['recovery-plan'] });

    logger.info('recovery-agent', `Plan: task=${taskId} strategy=${strategy} attempt=${attemptNumber}`);
    emit('RECOVERY_TRIGGERED', { taskId, strategy, reason, attemptNumber });
    return plan;
  }

  async executeRecovery(taskId: string, failureReason?: string): Promise<RecoveryResult> {
    logger.info('recovery-agent', `Recovering task=${taskId}`);
    try {
      const success = await recoveryEngine.recover(taskId, failureReason);
      const result: RecoveryResult = {
        success,
        taskId,
        strategy: 'auto',
        message:  success ? 'Recovery successful' : 'Recovery failed — manual intervention required',
        attempts: 1,
      };
      if (success) emit('CHECKPOINT_RESTORED', { taskId });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recovery error';
      logger.error('recovery-agent', `task=${taskId}: ${msg}`);
      return { success: false, taskId, strategy: 'none', message: msg, attempts: 1 };
    }
  }

  async checkpoint(
    taskId: string,
    step: number,
    data: { plan?: unknown; results?: unknown[]; sessionId?: string; userId?: string },
    meta?: Record<string, unknown>
  ): Promise<void> {
    await recoveryEngine.checkpoint(
      taskId,
      step,
      {
        messages:       [],
        plan:           data.plan,
        toolOutputs:    { results: data.results ?? [] },
        memorySnapshot: { sessionId: data.sessionId, userId: data.userId },
        variables:      { step, ...meta },
      },
      { userId: data.userId as string | undefined }
    );
    logger.debug('recovery-agent', `Checkpoint saved task=${taskId} step=${step}`);
  }

  getSystemPrompt(): string {
    return buildSystemPrompt('recovery');
  }
}

export const recoveryAgent = new RecoveryAgent();
