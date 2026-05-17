import { Router }       from 'express';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { store }        from '../utils/store.js';
import { PLANS }        from '../utils/config.js';
import { publicUser }   from '../services/userService.js';
import type { PlanName } from '../utils/config.js';

export const usageRouter = Router();

// GET /usage — current user's credits, plan, and recent history
usageRouter.get('/', authenticate, (req: AuthRequest, res) => {
  const user    = store.users.findById(req.user!.id)!;
  const plan    = PLANS[user.plan as PlanName];
  const recent  = store.usage.forUser(user.id, 50);
  const stats   = store.usage.statsByUser(user.id);

  const dailyResetInMs = Math.max(0, user.dailyResetAt - Date.now());
  const todayCount     = store.usage.countTodayForUser(user.id);

  res.json({
    user: publicUser(user),
    plan: {
      name:             user.plan,
      initialCredits:   plan.initialCredits,
      dailyRefill:      plan.dailyRefill,
      maxDailyRequests: plan.maxDailyRequests,
      minIntervalMs:    plan.minIntervalMs,
    },
    credits: {
      balance:        user.credits,
      dailyUsed:      user.dailyCreditsUsed,
      dailyResetInMs,
      dailyResetAt:   new Date(user.dailyResetAt).toISOString(),
    },
    today: {
      requests:      todayCount,
      requestsLeft:  plan.maxDailyRequests - todayCount,
    },
    stats,
    recent,
  });
});

// GET /usage/plans — show all plan tiers (public endpoint, no auth)
usageRouter.get('/plans', (_req, res) => {
  res.json(
    Object.entries(PLANS).map(([name, cfg]) => ({
      name,
      initialCredits:   cfg.initialCredits,
      dailyRefill:      cfg.dailyRefill,
      maxDailyRequests: cfg.maxDailyRequests,
      throttleMs:       cfg.minIntervalMs,
      imageProvider:    cfg.imageProvider,
      textProvider:     cfg.textProvider,
    }))
  );
});
