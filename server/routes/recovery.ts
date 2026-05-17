import { Router } from 'express';
import { checkpointStore } from '../recovery/checkpointStore.js';
import { recoveryEngine } from '../recovery/recoveryEngine.js';

export const recoveryRouter = Router();

// List all checkpoints, optionally filtered
recoveryRouter.get('/checkpoints', async (req, res) => {
  const q = req.query as Record<string, string>;
  try {
    const checkpoints = await checkpointStore.list({
      taskId:  q.taskId,
      agentId: q.agentId,
    });
    res.json(checkpoints);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// All checkpoints for a task
recoveryRouter.get('/checkpoints/:taskId', async (req, res) => {
  try {
    res.json(await checkpointStore.getByTaskId(req.params.taskId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// Most recent checkpoint for a task
recoveryRouter.get('/checkpoints/:taskId/latest', async (req, res) => {
  try {
    const cp = await checkpointStore.getLatestByTaskId(req.params.taskId);
    if (!cp) { res.status(404).json({ error: 'No checkpoint found for this task' }); return; }
    res.json(cp);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// Manually trigger recovery for a task
recoveryRouter.post('/recover/:taskId', async (req, res) => {
  const { failureReason } = req.body as { failureReason?: string };
  try {
    const success = await recoveryEngine.recover(req.params.taskId, failureReason);
    res.json({
      success,
      attempts: recoveryEngine.getAttempts(req.params.taskId),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Recovery failed' });
  }
});

// Recovery attempt history for a task
recoveryRouter.get('/attempts/:taskId', (req, res) => {
  res.json(recoveryEngine.getAttempts(req.params.taskId));
});

// Global recovery stats
recoveryRouter.get('/stats', (_req, res) => {
  res.json(recoveryEngine.getStats());
});

// Prune expired checkpoints
recoveryRouter.post('/checkpoints/prune', async (_req, res) => {
  try {
    const deleted = await checkpointStore.prune();
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Prune failed' });
  }
});
