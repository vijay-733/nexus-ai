import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';
import type { Job, QueueAdapter } from './queueTypes.js';

export type WorkerHandler<P = unknown, R = unknown> = (job: Job<P>) => Promise<R>;

export interface WorkerConfig {
  type: string;
  concurrency: number;
  handler: WorkerHandler;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface WorkerStats {
  id: string;
  type: string;
  active: number;
  concurrency: number;
  processed: number;
  failed: number;
  uptimeMs: number;
}

const emit = globalEventBus.createEmitter('worker-pool');

export class WorkerPool {
  private workers = new Map<string, {
    config:     WorkerConfig;
    active:     number;
    processed:  number;
    failed:     number;
    startedAt:  number;
    timer:      ReturnType<typeof setInterval>;
  }>();

  constructor(private readonly queue: QueueAdapter) {}

  register(config: WorkerConfig): string {
    const id = randomUUID();
    const state = {
      config,
      active:    0,
      processed: 0,
      failed:    0,
      startedAt: Date.now(),
      timer:     null as unknown as ReturnType<typeof setInterval>,
    };
    this.workers.set(id, state);

    const interval = config.pollIntervalMs ?? 100;
    state.timer = setInterval(async () => {
      if (state.active >= config.concurrency) return;
      const job = await this.queue.dequeue([config.type]).catch(() => null);
      if (job) void this.process(id, job);
    }, interval);
    state.timer.unref?.();

    return id;
  }

  unregister(id: string): void {
    const w = this.workers.get(id);
    if (!w) return;
    clearInterval(w.timer);
    this.workers.delete(id);
  }

  stats(): WorkerStats[] {
    return [...this.workers.entries()].map(([id, w]) => ({
      id,
      type:        w.config.type,
      active:      w.active,
      concurrency: w.config.concurrency,
      processed:   w.processed,
      failed:      w.failed,
      uptimeMs:    Date.now() - w.startedAt,
    }));
  }

  private async process(workerId: string, job: Job): Promise<void> {
    const w = this.workers.get(workerId);
    if (!w) return;

    w.active++;
    const timeoutMs = job.timeoutMs ?? w.config.timeoutMs ?? 60_000;

    emit('AGENT_STARTED', { workerId, jobId: job.id, type: job.type }, {
      taskId: job.taskId, userId: job.userId,
    });

    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Job "${job.type}" timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    try {
      const result = await Promise.race([w.config.handler(job), deadline]);
      await this.queue.complete(job.id, result);
      w.processed++;
      emit('AGENT_COMPLETED', { workerId, jobId: job.id, type: job.type }, {
        taskId: job.taskId, userId: job.userId,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.queue.fail(job.id, error).catch(() => null);
      w.failed++;
      emit('AGENT_FAILED', { workerId, jobId: job.id, type: job.type, error }, {
        taskId: job.taskId, userId: job.userId,
      });
    } finally {
      w.active--;
    }
  }
}
