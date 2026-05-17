import { Router } from 'express';
import { memory } from '../memory/memoryManager.js';
import { randomUUID } from 'crypto';

export const memoryRouter = Router();

// GET /memory?namespace=&key=&userId=&sessionId=&limit=&offset=
memoryRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  try {
    const results = await memory.query({
      namespace: q.namespace,
      key:       q.key,
      userId:    q.userId,
      sessionId: q.sessionId,
      taskId:    q.taskId,
      agentId:   q.agentId,
      limit:     q.limit  ? Number(q.limit)  : 50,
      offset:    q.offset ? Number(q.offset) : 0,
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Query failed' });
  }
});

// POST /memory
memoryRouter.post('/', async (req, res) => {
  const { namespace, key, value, tags, userId, taskId, agentId, sessionId, ttl } = req.body as {
    namespace: string; key: string; value: unknown;
    tags?: string[]; userId?: string; taskId?: string; agentId?: string; sessionId?: string; ttl?: number;
  };
  if (!namespace || !key || value === undefined) {
    res.status(400).json({ error: 'namespace, key, and value are required' });
    return;
  }
  try {
    const record = await memory.remember(namespace, key, value, { tags, userId, taskId, agentId, sessionId, ttl });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Write failed' });
  }
});

// GET /memory/stats/summary  (must be before /:namespace/:key to avoid shadowing)
memoryRouter.get('/stats/summary', async (_req, res) => {
  try {
    res.json(await memory.stats());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// GET /memory/conversation/:sessionId
memoryRouter.get('/conversation/:sessionId', async (req, res) => {
  try {
    const history = await memory.getConversationHistory(req.params.sessionId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// GET /memory/:namespace/:key
memoryRouter.get('/:namespace/:key', async (req, res) => {
  try {
    const value = await memory.recall(req.params.namespace, req.params.key);
    if (value === null) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ namespace: req.params.namespace, key: req.params.key, value });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Read failed' });
  }
});

// DELETE /memory/:namespace/:key
memoryRouter.delete('/:namespace/:key', async (req, res) => {
  try {
    const deleted = await memory.forget(req.params.namespace, req.params.key);
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
  }
});

// unused import guard
void randomUUID;
