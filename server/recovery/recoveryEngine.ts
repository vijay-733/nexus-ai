import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';
import { checkpointStore } from './checkpointStore.js';
import type { ExecutionCheckpoint, RecoveryContext } from './checkpoint.js';

export interface RecoveryAttempt {
  id: string;
  taskId: string;
  checkpointId: string;
  attemptNumber: number;
  strategy: 'resume' | 'restart' | 'fallback_provider';
  status: 'pending' | 'in_progress' | 'succeeded' | 'failed';
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const MAX_ATTEMPTS = 3;
const CHECKPOINT_TTL = 24 * 60 * 60_000; // 24h
const emit = globalEventBus.createEmitter('recovery-engine');

export class RecoveryEngine {
  private attempts = new Map<string, RecoveryAttempt[]>(); // taskId → []
  private handlers = new Map<string, (ctx: RecoveryContext) => Promise<void>>();
  private gcTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.gcTimer = setInterval(() => void checkpointStore.prune(), 60 * 60_000);
    this.gcTimer.unref?.();
  }

  registerResumeHandler(taskId: string, fn: (ctx: RecoveryContext) => Promise<void>): void {
    this.handlers.set(taskId, fn);
  }

  unregisterResumeHandler(taskId: string): void {
    this.handlers.delete(taskId);
  }

  async checkpoint(
    taskId: string,
    step: number,
    state: ExecutionCheckpoint['state'],
    meta?: Partial<ExecutionCheckpoint['metadata']>
  ): Promise<ExecutionCheckpoint> {
    const cp = await checkpointStore.save({
      taskId,
      step,
      phase: 'executing',
      state,
      metadata: {
        startedAt:     Date.now(),
        lastUpdatedAt: Date.now(),
        retryCount:    0,
        ...meta,
      },
      expiresAt: Date.now() + CHECKPOINT_TTL,
    });

    emit('CHECKPOINT_SAVED', { taskId, checkpointId: cp.id, step }, { taskId });
    return cp;
  }

  async recover(taskId: string, failureReason?: string): Promise<boolean> {
    const cp = await checkpointStore.getLatestByTaskId(taskId);
    if (!cp) {
      emit('RECOVERY_TRIGGERED', { taskId, result: 'no_checkpoint', failureReason }, { taskId });
      return false;
    }

    const existing = this.attempts.get(taskId) ?? [];
    const failedCount = existing.filter(a => a.status === 'failed').length;
    if (failedCount >= MAX_ATTEMPTS) {
      emit('RECOVERY_TRIGGERED', { taskId, result: 'max_attempts_exceeded', failureReason }, { taskId });
      return false;
    }

    const attempt: RecoveryAttempt = {
      id:            randomUUID(),
      taskId,
      checkpointId:  cp.id,
      attemptNumber: existing.length + 1,
      strategy:      this.pickStrategy(existing),
      status:        'in_progress',
      startedAt:     Date.now(),
    };
    existing.push(attempt);
    this.attempts.set(taskId, existing);

    emit('RECOVERY_TRIGGERED', {
      taskId,
      checkpointId:  cp.id,
      attempt:       attempt.attemptNumber,
      strategy:      attempt.strategy,
      failureReason,
    }, { taskId });

    const handler = this.handlers.get(taskId);
    if (!handler) {
      attempt.status      = 'failed';
      attempt.error       = 'No resume handler registered for task';
      attempt.completedAt = Date.now();
      return false;
    }

    const ctx: RecoveryContext = {
      checkpoint: cp,
      resumeFrom: attempt.strategy === 'restart' ? 'plan_start' : 'last_step',
      injectedContext: failureReason
        ? `Previous execution failed at step ${cp.step}: ${failureReason}. Continuing recovery attempt ${attempt.attemptNumber}.`
        : undefined,
    };

    try {
      await handler(ctx);
      attempt.status      = 'succeeded';
      attempt.completedAt = Date.now();
      emit('CHECKPOINT_RESTORED', { taskId, checkpointId: cp.id, step: cp.step }, { taskId });
      return true;
    } catch (err) {
      attempt.status      = 'failed';
      attempt.error       = String(err);
      attempt.completedAt = Date.now();
      return false;
    }
  }

  getAttempts(taskId: string): RecoveryAttempt[] {
    return this.attempts.get(taskId) ?? [];
  }

  getStats(): {
    totalRecoveries: number;
    succeeded: number;
    failed: number;
    byStrategy: Record<string, number>;
    tasksWithCheckpoints: number;
  } {
    let total = 0, succeeded = 0, failed = 0;
    const byStrategy: Record<string, number> = {};
    for (const list of this.attempts.values()) {
      for (const a of list) {
        total++;
        if (a.status === 'succeeded') succeeded++;
        if (a.status === 'failed')    failed++;
        byStrategy[a.strategy] = (byStrategy[a.strategy] ?? 0) + 1;
      }
    }
    return {
      totalRecoveries: total,
      succeeded,
      failed,
      byStrategy,
      tasksWithCheckpoints: this.attempts.size,
    };
  }

  private pickStrategy(previous: RecoveryAttempt[]): RecoveryAttempt['strategy'] {
    const failed = previous.filter(a => a.status === 'failed').length;
    if (failed === 0) return 'resume';
    if (failed === 1) return 'restart';
    return 'fallback_provider';
  }
}

export const recoveryEngine = new RecoveryEngine();
