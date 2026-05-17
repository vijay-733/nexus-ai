import { Router } from 'express';
import { creditsSystem } from '../billing/creditsSystem.js';
import { PLANS, getPlan } from '../billing/plans.js';
import { checkQuota } from '../billing/quotaManager.js';
import type { AuthRequest } from '../governance/accessControl.js';
import type { PlanId } from '../billing/plans.js';

export const billingRouter = Router();

billingRouter.get('/account', (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const account = creditsSystem.getOrCreate(userId);
  const txns    = creditsSystem.getTransactions(userId, 20);
  res.json({
    userId:       account.userId,
    plan:         account.planId,
    credits:      account.credits,
    creditsUsed:  account.creditsUsedThisMonth,
    resetAt:      account.resetAt,
    transactions: txns.map(t => ({
      id:        t.id,
      amount:    t.amount,
      action:    t.action ?? t.description,
      timestamp: t.createdAt,
    })),
  });
});

billingRouter.get('/plans', (_req, res) => {
  res.json(Object.values(PLANS));
});

billingRouter.get('/transactions', (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const limit = Number((req.query as Record<string, string>).limit) || 50;
  res.json(creditsSystem.getTransactions(userId, limit));
});

billingRouter.post('/upgrade', (req: AuthRequest, res) => {
  const userId  = req.user?.id;
  const body    = req.body as { planId?: PlanId; plan?: PlanId };
  const planId  = body.planId ?? body.plan;
  if (!userId)              { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!planId || !PLANS[planId]) { res.status(400).json({ error: 'Invalid plan ID' }); return; }
  const account = creditsSystem.upgradePlan(userId, planId);
  res.json({ account });
});

billingRouter.get('/quota', (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.json(checkQuota(userId));
});

// Admin: credit top-up (no auth guard here — add requirePermission in production)
billingRouter.post('/credit', (req: AuthRequest, res) => {
  const { userId, amount, description } = req.body as {
    userId?: string; amount?: number; description?: string;
  };
  const target = userId ?? req.user?.id;
  if (!target || !amount || amount <= 0) {
    res.status(400).json({ error: 'userId and positive amount are required' });
    return;
  }
  const account = creditsSystem.credit(target, amount, description ?? 'Manual top-up');
  res.json({ account });
});
