import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import type { Job, JobStatus, JobPriority, QueueAdapter } from './queueTypes.js';

// ── Redis key schema ──────────────────────────────────────────────────────────
// nexus:queue:<name>:<priority>  → sorted set (score = scheduled_at ms)
// nexus:job:<id>                 → hash (all job fields as JSON)
// nexus:queue:processing         → hash jobId → workerTag
// nexus:queue:dlq                → list of JSON-serialised failed jobs

const KEY = {
  queue:      (name: string, p: string) => `nexus:queue:${name}:${p}`,
  job:        (id: string)              => `nexus:job:${id}`,
  processing: ()                        => 'nexus:queue:processing',
  dlq:        ()                        => 'nexus:queue:dlq',
};

const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
};

const PRIORITIES: JobPriority[] = ['critical', 'high', 'normal', 'low'];

export class RedisQueueAdapter implements QueueAdapter {
  private redis: Redis;
  private sub:   Redis;
  private ready  = false;

  constructor(redisUrl?: string) {
    const url    = redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redis   = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
    this.sub     = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
  }

  async connect(): Promise<void> {
    await Promise.all([this.redis.connect(), this.sub.connect()]);
    this.ready = true;
    logger.info('redis-queue', 'Connected');
    this.startDLQReaper();
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.redis.quit(), this.sub.quit()]);
    this.ready = false;
  }

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
      timeoutMs:   opts?.timeoutMs   ?? 60_000,
    };

    const score = Date.now() + PRIORITY_WEIGHTS[job.priority] * 1_000;
    const qKey  = KEY.queue('default', job.priority);

    await this.redis.pipeline()
      .set(KEY.job(job.id), JSON.stringify(job))
      .zadd(qKey, score, job.id)
      .exec();

    logger.debug('redis-queue', `Enqueued job=${job.id} type=${type} priority=${job.priority}`);
    return job;
  }

  async dequeue(types?: string[]): Promise<Job | null> {
    for (const priority of PRIORITIES) {
      const qKey = KEY.queue('default', priority);
      const now  = Date.now() + 10_000; // visible window

      const ids = await this.redis.zrangebyscore(qKey, '-inf', now, 'LIMIT', 0, 1);
      if (!ids.length) continue;

      const id = ids[0];
      const removed = await this.redis.zrem(qKey, id);
      if (!removed) continue; // another worker claimed it

      const raw = await this.redis.get(KEY.job(id));
      if (!raw) continue;

      const job: Job = JSON.parse(raw);

      if (types && types.length > 0 && !types.includes(job.type)) {
        // Put back — wrong type for this worker
        await this.redis.zadd(qKey, Date.now(), id);
        continue;
      }

      job.status    = 'running';
      job.startedAt = Date.now();
      job.attempts += 1;

      await this.redis.pipeline()
        .set(KEY.job(id), JSON.stringify(job))
        .hset(KEY.processing(), id, Date.now().toString())
        .exec();

      return job;
    }
    return null;
  }

  async complete(jobId: string, result: unknown): Promise<void> {
    const raw = await this.redis.get(KEY.job(jobId));
    if (!raw) return;

    const job: Job = JSON.parse(raw);
    job.status      = 'completed';
    job.result      = result;
    job.completedAt = Date.now();

    await this.redis.pipeline()
      .set(KEY.job(jobId), JSON.stringify(job), 'EX', 3600) // TTL 1h
      .hdel(KEY.processing(), jobId)
      .exec();
  }

  async fail(jobId: string, error: string): Promise<void> {
    const raw = await this.redis.get(KEY.job(jobId));
    if (!raw) return;

    const job: Job = JSON.parse(raw);
    job.error       = error;

    await this.redis.hdel(KEY.processing(), jobId);

    if (job.attempts < job.maxAttempts) {
      // Exponential backoff: 2^attempt * 5s, capped at 5min
      const delay = Math.min(5_000 * Math.pow(2, job.attempts), 300_000);
      const score = Date.now() + delay;
      job.status  = 'retrying';

      await this.redis.pipeline()
        .set(KEY.job(jobId), JSON.stringify(job))
        .zadd(KEY.queue('default', job.priority), score, jobId)
        .exec();

      logger.warn('redis-queue', `Retry job=${jobId} attempt=${job.attempts}/${job.maxAttempts} delay=${delay}ms`);
    } else {
      job.status      = 'failed';
      job.completedAt = Date.now();

      await this.redis.pipeline()
        .set(KEY.job(jobId), JSON.stringify(job), 'EX', 86_400) // 24h TTL for failed
        .lpush(KEY.dlq(), JSON.stringify({ job, failedAt: Date.now(), error }))
        .ltrim(KEY.dlq(), 0, 9_999) // cap DLQ at 10k entries
        .exec();

      logger.error('redis-queue', `DLQ job=${jobId} type=${job.type} error=${error}`);
    }
  }

  async get(jobId: string): Promise<Job | null> {
    const raw = await this.redis.get(KEY.job(jobId));
    return raw ? JSON.parse(raw) : null;
  }

  async list(filter?: {
    status?: JobStatus;
    type?: string;
    userId?: string;
  }): Promise<Job[]> {
    const jobs: Job[] = [];
    for (const priority of PRIORITIES) {
      const ids = await this.redis.zrange(KEY.queue('default', priority), 0, -1);
      for (const id of ids) {
        const raw = await this.redis.get(KEY.job(id));
        if (!raw) continue;
        const job: Job = JSON.parse(raw);
        if (filter?.status && job.status !== filter.status) continue;
        if (filter?.type   && job.type   !== filter.type)   continue;
        if (filter?.userId && job.userId !== filter.userId) continue;
        jobs.push(job);
      }
    }
    return jobs;
  }

  async size(type?: string): Promise<number> {
    let total = 0;
    for (const priority of PRIORITIES) {
      const count = await this.redis.zcard(KEY.queue('default', priority));
      total += count;
    }
    return total;
  }

  async getDLQ(limit = 50): Promise<Array<{ job: Job; failedAt: number; error: string }>> {
    const raw = await this.redis.lrange(KEY.dlq(), 0, limit - 1);
    return raw.map(r => JSON.parse(r));
  }

  async requeueFromDLQ(jobId: string): Promise<boolean> {
    const items = await this.getDLQ(500);
    const entry = items.find(e => e.job.id === jobId);
    if (!entry) return false;

    const job = entry.job;
    job.status   = 'pending';
    job.attempts = 0;
    job.error    = undefined;

    await this.enqueue(job.type, job.payload, {
      priority:    job.priority,
      maxAttempts: job.maxAttempts,
      userId:      job.userId,
      taskId:      job.taskId,
      timeoutMs:   job.timeoutMs,
    });
    return true;
  }

  // Reap stuck processing jobs (heartbeat timeout: 5min)
  private startDLQReaper(): void {
    setInterval(async () => {
      try {
        const processing = await this.redis.hgetall(KEY.processing());
        const staleThreshold = Date.now() - 5 * 60_000;
        for (const [jobId, startedAt] of Object.entries(processing)) {
          if (Number(startedAt) < staleThreshold) {
            await this.fail(jobId, 'Job timed out — no heartbeat');
          }
        }
      } catch {
        // Ignore reaper errors
      }
    }, 60_000).unref?.();
  }

  async healthCheck(): Promise<{ ok: boolean; queueDepth: number; dlqDepth: number }> {
    try {
      await this.redis.ping();
      const [queueDepth, dlqDepth] = await Promise.all([
        this.size(),
        this.redis.llen(KEY.dlq()),
      ]);
      return { ok: true, queueDepth, dlqDepth };
    } catch {
      return { ok: false, queueDepth: 0, dlqDepth: 0 };
    }
  }
}
