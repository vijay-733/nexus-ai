import { Router }                from 'express';
import { InMemoryQueueAdapter } from '../queue/inMemoryQueueAdapter.js';
import { RedisQueueAdapter }    from '../queue/redisQueueAdapter.js';
import { WorkerPool }           from '../queue/workerPool.js';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { logger }               from '../utils/logger.js';
import type { QueueAdapter }    from '../queue/queueTypes.js';

// ── Adapter selection: Redis if available, else in-memory ─────────────────────
let queueAdapter: QueueAdapter;
let redisAdapter: RedisQueueAdapter | null = null;

if (process.env.REDIS_URL) {
  redisAdapter  = new RedisQueueAdapter();
  queueAdapter  = redisAdapter;
  redisAdapter.connect().catch(err => {
    logger.warn('queue', `Redis queue connect failed: ${err instanceof Error ? err.message : err} — falling back to in-memory`);
    queueAdapter = new InMemoryQueueAdapter();
    redisAdapter  = null;
  });
} else {
  queueAdapter = new InMemoryQueueAdapter();
}

export { queueAdapter };
export const workerPool = new WorkerPool(queueAdapter);

export const queueRouter = Router();

// GET /queue/jobs
queueRouter.get('/jobs', authenticate, async (req: AuthRequest, res) => {
  const q = req.query as Record<string, string>;
  try {
    const jobs = await queueAdapter.list({
      status: q.status as never,
      type:   q.type,
      userId: req.user!.plan === 'admin' ? q.userId : req.user!.id,
    });
    res.json({ count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// GET /queue/jobs/:id
queueRouter.get('/jobs/:id', authenticate, async (req: AuthRequest, res) => {
  const job = await queueAdapter.get(req.params.id);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  res.json(job);
});

// POST /queue/jobs
queueRouter.post('/jobs', authenticate, async (req: AuthRequest, res) => {
  const { type, payload, priority, maxAttempts, taskId, timeoutMs } = req.body as {
    type: string; payload: unknown; priority?: never;
    maxAttempts?: number; taskId?: string; timeoutMs?: number;
  };
  if (!type || payload === undefined) {
    res.status(400).json({ error: 'type and payload are required' });
    return;
  }
  const job = await queueAdapter.enqueue(type, payload, {
    priority, maxAttempts, userId: req.user!.id, taskId, timeoutMs,
  });
  res.status(202).json(job);
});

// GET /queue/size
queueRouter.get('/size', async (req, res) => {
  const type = (req.query as Record<string, string>).type;
  res.json({ size: await queueAdapter.size(type) });
});

// GET /queue/workers
queueRouter.get('/workers', (_req, res) => {
  res.json(workerPool.stats());
});

// GET /queue/dlq  — Dead letter queue (admin or Redis only)
queueRouter.get('/dlq', authenticate, async (req: AuthRequest, res) => {
  if (!redisAdapter) {
    res.json({ message: 'DLQ only available with Redis adapter', items: [] });
    return;
  }
  try {
    const limit = Number((req.query as Record<string, string>).limit ?? 50);
    const items = await redisAdapter.getDLQ(Math.min(limit, 200));
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// POST /queue/dlq/:jobId/requeue  — Requeue a failed job from DLQ
queueRouter.post('/dlq/:jobId/requeue', authenticate, async (req: AuthRequest, res) => {
  if (!redisAdapter) {
    res.status(400).json({ error: 'DLQ requeue only available with Redis adapter' });
    return;
  }
  const ok = await redisAdapter.requeueFromDLQ(req.params.jobId);
  if (!ok) { res.status(404).json({ error: 'Job not found in DLQ' }); return; }
  res.json({ requeued: true, jobId: req.params.jobId });
});

// GET /queue/health
queueRouter.get('/health', async (_req, res) => {
  if (redisAdapter) {
    const health = await redisAdapter.healthCheck();
    res.json({ adapter: 'redis', ...health });
  } else {
    const size = await queueAdapter.size();
    res.json({ adapter: 'in-memory', ok: true, queueDepth: size, dlqDepth: 0 });
  }
});
