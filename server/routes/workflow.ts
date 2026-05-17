import { Router } from 'express';
import { workflowEngine } from '../workflow/workflowEngine.js';
import type { WorkflowNode } from '../workflow/workflowTypes.js';
import type { AuthRequest } from '../governance/accessControl.js';

export const workflowRouter = Router();

workflowRouter.get('/', (req: AuthRequest, res) => {
  const q  = req.query as Record<string, string>;
  const wf = workflowEngine.list({
    userId: q.userId ?? req.user?.id,
    status: q.status as never,
  });
  res.json(wf);
});

workflowRouter.post('/', async (req: AuthRequest, res) => {
  const { name, description, nodes, input } = req.body as {
    name:         string;
    description?: string;
    nodes:        Omit<WorkflowNode, 'status' | 'retries'>[];
    input?:       unknown;
  };
  if (!name || !Array.isArray(nodes) || !nodes.length) {
    res.status(400).json({ error: 'name and nodes[] are required' });
    return;
  }

  const wf = workflowEngine.create(name, nodes, {
    userId:      req.user?.id,
    description,
    input:       input ?? {},
  });

  void workflowEngine.run(wf.id).catch(err =>
    console.error(`[WorkflowEngine] ${wf.id} failed:`, err)
  );

  res.status(202).json({ id: wf.id, status: wf.status, nodeCount: wf.nodes.length });
});

workflowRouter.get('/stats', (_req, res) => {
  res.json(workflowEngine.stats());
});

workflowRouter.get('/:id', (req, res) => {
  const wf = workflowEngine.get(req.params.id);
  if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
  res.json(wf);
});

workflowRouter.post('/:id/cancel', (req, res) => {
  const ok = workflowEngine.cancel(req.params.id);
  if (!ok) { res.status(404).json({ error: 'Workflow not found or not running' }); return; }
  res.json({ cancelled: true });
});
