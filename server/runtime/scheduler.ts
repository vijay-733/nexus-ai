import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';

export type JobType = 'once' | 'interval';

export interface Job {
  id: string;
  name: string;
  type: JobType;
  fn: () => void | Promise<void>;
  intervalMs?: number;
  lastRun?: number;
  nextRun: number;
  runCount: number;
  enabled: boolean;
  createdAt: number;
}

export class Scheduler {
  private jobs  = new Map<string, Job>();
  private timer: ReturnType<typeof setInterval>;

  constructor(tickMs = 1000) {
    this.timer = setInterval(() => void this.tick(), tickMs);
    this.timer.unref?.();
  }

  schedule(
    name: string,
    fn: () => void | Promise<void>,
    opts: { type?: JobType; intervalMs?: number; delayMs?: number; runAt?: number }
  ): string {
    const id   = randomUUID();
    const now  = Date.now();
    const type = opts.type ?? (opts.intervalMs ? 'interval' : 'once');
    const nextRun = opts.runAt ?? (opts.delayMs ? now + opts.delayMs : now);

    this.jobs.set(id, {
      id, name, type, fn,
      intervalMs: opts.intervalMs,
      nextRun,
      runCount: 0,
      enabled: true,
      createdAt: now,
    });

    return id;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.enabled = false;
    return true;
  }

  remove(id: string): boolean {
    return this.jobs.delete(id);
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (!job.enabled || job.nextRun > now) continue;

      job.lastRun  = now;
      job.runCount++;

      try {
        await job.fn();
        globalEventBus.createEmitter('scheduler')(
          'SYSTEM_STARTED',
          { jobId: job.id, name: job.name, runCount: job.runCount }
        );
      } catch (err) {
        globalEventBus.createEmitter('scheduler')(
          'SYSTEM_ERROR',
          { jobId: job.id, name: job.name, error: String(err) }
        );
      }

      if (job.type === 'once') {
        job.enabled = false;
      } else if (job.type === 'interval' && job.intervalMs) {
        job.nextRun = now + job.intervalMs;
      }
    }

    for (const [id, job] of this.jobs) {
      if (!job.enabled && job.type === 'once' && Date.now() - (job.lastRun ?? 0) > 60_000) {
        this.jobs.delete(id);
      }
    }
  }
}

export const scheduler = new Scheduler();
