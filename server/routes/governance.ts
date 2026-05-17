import { Router } from 'express';
import { policyEngine } from '../governance/policyEngine.js';
import { approvalWorkflow } from '../governance/approvalWorkflow.js';
import { ROLE_PERMISSIONS } from '../governance/permissions.js';
import type { Role } from '../governance/permissions.js';

export const governanceRouter = Router();

// ── Policies ─────────────────────────────────────────────────────────────────

governanceRouter.get('/policies', (_req, res) => {
  res.json(policyEngine.list());
});

governanceRouter.post('/policies', (req, res) => {
  const { name, description, priority, effect, conditions, enabled } = req.body as {
    name: string; description: string; priority?: number;
    effect: 'allow' | 'deny'; conditions: unknown[]; enabled?: boolean;
  };
  if (!name || !description || !effect || !conditions) {
    res.status(400).json({ error: 'name, description, effect, and conditions are required' });
    return;
  }
  const policy = policyEngine.add({
    name, description, priority: priority ?? 50, effect,
    conditions: conditions as never, enabled: enabled ?? true,
  });
  res.status(201).json(policy);
});

governanceRouter.patch('/policies/:id', (req, res) => {
  const updated = policyEngine.update(req.params.id, req.body as never);
  if (!updated) { res.status(404).json({ error: 'Policy not found' }); return; }
  res.json(updated);
});

governanceRouter.delete('/policies/:id', (req, res) => {
  const deleted = policyEngine.remove(req.params.id);
  if (!deleted) { res.status(404).json({ error: 'Policy not found' }); return; }
  res.json({ deleted: true });
});

// ── Permissions ───────────────────────────────────────────────────────────────

governanceRouter.get('/permissions', (_req, res) => {
  res.json(ROLE_PERMISSIONS);
});

governanceRouter.get('/permissions/:role', (req, res) => {
  const perms = ROLE_PERMISSIONS[req.params.role as Role];
  if (!perms) { res.status(404).json({ error: 'Role not found' }); return; }
  res.json(perms);
});

// ── Approvals ─────────────────────────────────────────────────────────────────

governanceRouter.get('/approvals', (req, res) => {
  const status = (req.query as Record<string, string>).status as
    'pending' | 'approved' | 'denied' | 'expired' | undefined;
  res.json(approvalWorkflow.list(status));
});

governanceRouter.post('/approvals', (req, res) => {
  const { action, description, requestedBy, agentId, taskId } = req.body as {
    action: string; description: string; requestedBy?: string; agentId?: string; taskId?: string;
  };
  if (!action || !description) {
    res.status(400).json({ error: 'action and description are required' });
    return;
  }
  const { id } = approvalWorkflow.request(action, description, { requestedBy, agentId, taskId });
  res.status(202).json({ id, status: 'pending' });
});

governanceRouter.get('/approvals/:id', (req, res) => {
  const approval = approvalWorkflow.get(req.params.id);
  if (!approval) { res.status(404).json({ error: 'Approval not found' }); return; }
  res.json(approval);
});

governanceRouter.post('/approvals/:id/approve', (req, res) => {
  const ok = approvalWorkflow.approve(req.params.id, (req.body as { resolvedBy?: string }).resolvedBy);
  if (!ok) { res.status(404).json({ error: 'Approval not found or already resolved' }); return; }
  res.json({ approved: true });
});

governanceRouter.post('/approvals/:id/deny', (req, res) => {
  const ok = approvalWorkflow.deny(req.params.id, (req.body as { resolvedBy?: string }).resolvedBy);
  if (!ok) { res.status(404).json({ error: 'Approval not found or already resolved' }); return; }
  res.json({ denied: true });
});
