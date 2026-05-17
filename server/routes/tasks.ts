// Task Management REST API
//
// Endpoints:
//   POST   /tasks            Submit a task. Default: synchronous (HTTP waits for result).
//                            ?async=true  → HTTP 202 + taskId immediately; client polls.
//   GET    /tasks            List current user's recent tasks (logs excluded).
//   GET    /tasks/health     Queue + store stats (no auth required).
//   GET    /tasks/:id        Full task detail (logs excluded — use /logs).
//   GET    /tasks/:id/logs   Paginated structured logs for one task.
//   DELETE /tasks/:id        Cancel a queued or running task.
//   DELETE /tasks/:id/data   Permanently delete the task record.
//
// Auth: every endpoint (except /health) requires a valid JWT via authenticate().
// Rate limiting: agentLimiter on POST (same limit as /agent/*).

import { Router }        from 'express';
import { agentLimiter }  from '../middleware/rateLimiter.js';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { validate }      from '../middleware/validate.js';
import { taskStore }     from '../state/taskStore.js';
import {
  runTaskSync,
  submitTaskAsync,
  cancelTask,
  queueStats,
}                        from '../engine/taskEngine.js';

export const tasksRouter = Router();

// ── POST /tasks ───────────────────────────────────────────────────────────────
// Body: { kind, input, priority?, options? }
// ?async=true → 202 + { taskId, status: 'queued' }
// default     → 200/422/402 + full Task object
tasksRouter.post(
  '/',
  agentLimiter,
  authenticate,
  validate({
    kind:  { type: 'string', required: true, oneOf: ['multi', 'react', 'single'] },
    input: { type: 'string', required: true, minLen: 3, maxLen: 4000 },
  }),
  async (req: AuthRequest, res) => {
    const { kind, input, priority, options } = req.body as {
      kind:      'multi' | 'react' | 'single';
      input:     string;
      priority?: 'high' | 'normal' | 'low';
      options?:  Record<string, unknown>;
    };

    const isAsync = req.query['async'] === 'true';

    if (isAsync) {
      const taskId = submitTaskAsync({ userId: req.user!.id, kind, input, priority, options });
      return res.status(202).json({ taskId, status: 'queued' });
    }

    const task   = await runTaskSync({ userId: req.user!.id, kind, input, priority, options });
    const status = task.status === 'done'
      ? 200
      : task.error?.includes('credit') ? 402 : 422;

    // Strip per-task logs from the response — use GET /tasks/:id/logs for those
    const { logs: _logs, ...rest } = task;
    res.status(status).json({ ...rest, logCount: _logs.length });
  },
);

// ── GET /tasks ────────────────────────────────────────────────────────────────
// Returns latest N tasks for the authenticated user (logs stripped).
tasksRouter.get('/', authenticate, (req: AuthRequest, res) => {
  const limit = Math.min(Number(req.query['limit'] ?? 20), 100);
  const tasks = taskStore.listForUser(req.user!.id, limit);
  const slim  = tasks.map(({ logs: _l, ...rest }) => rest);
  res.json({ count: slim.length, tasks: slim });
});

// ── GET /tasks/health ─────────────────────────────────────────────────────────
// Queue depth, concurrency, and store statistics. No auth required.
tasksRouter.get('/health', (_req, res) => {
  res.json(queueStats());
});

// ── GET /tasks/:id ────────────────────────────────────────────────────────────
// Full task detail. Logs are excluded from this response — call /logs for them.
tasksRouter.get('/:id', authenticate, (req: AuthRequest, res) => {
  const task = taskStore.get(req.params.id);
  if (!task)                        return res.status(404).json({ error: 'Task not found' });
  if (task.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  const { logs: _l, ...rest } = task;
  res.json({ ...rest, logCount: _l.length });
});

// ── GET /tasks/:id/logs ───────────────────────────────────────────────────────
// Paginated structured log entries for debugging.
// Query params: limit (default 100, max 200), offset (default 0).
tasksRouter.get('/:id/logs', authenticate, (req: AuthRequest, res) => {
  const task = taskStore.get(req.params.id);
  if (!task)                        return res.status(404).json({ error: 'Task not found' });
  if (task.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  const limit  = Math.min(Number(req.query['limit']  ?? 100), 200);
  const offset = Math.max(Number(req.query['offset'] ?? 0),   0);

  res.json({
    taskId: task.id,
    status: task.status,
    total:  task.logs.length,
    offset,
    limit,
    logs:   task.logs.slice(offset, offset + limit),
  });
});

// ── DELETE /tasks/:id ─────────────────────────────────────────────────────────
// Cancels a queued or running task. Returns 409 if already terminal.
tasksRouter.delete('/:id', authenticate, (req: AuthRequest, res) => {
  const task = taskStore.get(req.params.id);
  if (!task)                        return res.status(404).json({ error: 'Task not found' });
  if (task.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  const ok = cancelTask(req.params.id, req.user!.id);
  if (!ok) return res.status(409).json({ error: 'Task already completed — cannot cancel' });
  res.json({ cancelled: true, taskId: req.params.id });
});

// ── DELETE /tasks/:id/data ────────────────────────────────────────────────────
// Permanently removes the task record from the store and disk.
tasksRouter.delete('/:id/data', authenticate, (req: AuthRequest, res) => {
  const task = taskStore.get(req.params.id);
  if (!task)                        return res.status(404).json({ error: 'Task not found' });
  if (task.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  taskStore.delete(req.params.id, req.user!.id);
  res.json({ deleted: true, taskId: req.params.id });
});
