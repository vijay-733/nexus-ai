import type { Response, NextFunction } from 'express';
import { creditsSystem } from '../billing/creditsSystem.js';
import { getPlan } from '../billing/plans.js';
import { deductCredits, checkRateLimit } from '../billing/quotaManager.js';
import type { AuthRequest } from '../governance/accessControl.js';

export function requirePlanFeature(feature: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const account = creditsSystem.getOrCreate(userId);
    const plan    = getPlan(account.planId);

    if (!plan.features.includes(feature)) {
      const upgrade = plan.id === 'free' ? 'Pro or Enterprise' : 'Enterprise';
      res.status(403).json({
        error:           `Feature "${feature}" requires ${upgrade} plan`,
        currentPlan:     account.planId,
        requiredFeature: feature,
      });
      return;
    }
    next();
  };
}

export function requireCredits(action: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const result = deductCredits(userId, action);
    if (!result.allowed) {
      res.status(429).json({ error: result.reason ?? 'Usage limit exceeded', remaining: result.remaining });
      return;
    }

    (req as AuthRequest & { creditsRemaining?: number }).creditsRemaining = result.remaining;
    next();
  };
}

export function enforceRateLimit() {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) { next(); return; } // unauthenticated passes through (auth middleware handles it)

    const result = checkRateLimit(userId);
    if (!result.allowed) {
      res.status(429).json({ error: result.reason ?? 'Rate limit exceeded', remaining: 0 });
      return;
    }
    next();
  };
}
