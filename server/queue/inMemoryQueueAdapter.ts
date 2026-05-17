import { randomUUID } from 'crypto';
import type { Job, JobStatus, JobPriority, QueueAdapter } from './queueTypes.js';

const PRIORITY_ORDER: Record<JobPriority, number> = {
  critical: 0, high: 1, normal: 2, low: 3,
};

const BACKOFF_MS = (attempts: number) =>
  Math.min(1_000 * Math.pow(2, attempts - 1), 30_000);

export class InMemoryQueueAdapter implements QueueAdapter {
  private jobs   = new Map<string, Job>();
  private queues = new Map<string, string[]>(); // type → sorted jobIds

  async enqueue<P>(
    type: string,
    payload: P,
    opts?: Partial<Pick<Job, 'priority' | 'maxAttempts' | 'userId' | 'taskId' | 'timeoutMs'>>
  ): Promise<Job<P>> {
    const job: Job<P> = {
      id:          randomUUID(),
      type,
      payload,
      priority:    opts?.priority    ?? 'normal',
      status:      'pending',
      attempts:    0,
      maxAttempts: opts?.maxAttempts ?? 3,
      createdAt:   Date.now(),
      userId:      opts?.userId,
      taskId:      opts?.taskId,
      timeoutMs:   opts?.timeoutMs,
    };
    this.jobs.set(job.id, job as Job);
    if (!this.queues.has(type)) this.queues.set(type, []);
    this.queues.get(type)!.push(job.id);
    this.sortQueue(type);
    return job;
  }

  async dequeue(types?: string[]): Promise<Job | null> {
    const typeList = types?.length ? types : [...this.queues.keys()];
    for (const type of typeList) {
      const ids = this.queues.get(type) ?? [];
      for (const id of ids) {
        const job = this.jobs.get(id);
        if (job?.status === 'pending') {
          job.status    = 'running';
          job.startedAt = Date.now();
          job.attempts++;
          return job;
        }
      }
    }
    return null;
  }

  async complete(jobId: string, result: unknown): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status      = 'completed';
    job.result      = result;
    job.completedAt = Date.now();
  }

  async fail(jobId: string, error: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.error = error;
    if (job.attempts < job.maxAttempts) {
      job.status = 'retrying';
      setTimeout(() => {
        const j = this.jobs.get(jobId);
        if (j?.status === 'retrying') j.status = 'pending';
      }, BACKOFF_MS(job.attempts));
    } else {
      job.status      = 'failed';
      job.completedAt = Date.now();
    }
  }

  async get(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async list(filter?: { status?: JobStatus; type?: string; userId?: string }): Promise<Job[]> {
    let jobs = [...this.jobs.values()];
    if (filter?.status) jobs = jobs.filter(j => j.status === filter.status);
    if (filter?.type)   jobs = jobs.filter(j => j.type   === filter.type);
    if (filter?.userId) jobs = jobs.filter(j => j.userId === filter.userId);
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  async size(type?: string): Promise<number> {
    if (type) {
      return (this.queues.get(type) ?? [])
        .filter(id => this.jobs.get(id)?.status === 'pending').length;
    }
    let n = 0;
    for (const job of this.jobs.values()) if (job.status === 'pending') n++;
    return n;
  }

  private sortQueue(type: string): void {
    const ids = this.queues.get(type) ?? [];
    ids.sort((a, b) => {
      const ja = this.jobs.get(a);
      const jb = this.jobs.get(b);
      if (!ja || !jb) return 0;
      const pd = PRIORITY_ORDER[ja.priority] - PRIORITY_ORDER[jb.priority];
      return pd !== 0 ? pd : ja.createdAt - jb.createdAt;
    });
  }
}
