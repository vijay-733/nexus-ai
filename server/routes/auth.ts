import { Router }                      from 'express';
import { authLimiter }                 from '../middleware/rateLimiter.js';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { validate }                    from '../middleware/validate.js';
import { registerUser, loginUser, publicUser } from '../services/userService.js';
import { signToken }                   from '../utils/jwt.js';
import { store }                       from '../utils/store.js';
import { logger }                      from '../utils/logger.js';
import type { PlanName }               from '../utils/config.js';

export const authRouter = Router();

// POST /auth/register
authRouter.post(
  '/register',
  authLimiter,
  validate({
    email:    { type: 'string', required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    name:     { type: 'string', required: true, minLen: 2, maxLen: 60 },
    password: { type: 'string', required: true, minLen: 8, maxLen: 128 },
    plan:     { type: 'string', oneOf: ['free', 'pro', 'enterprise'] },
  }),
  async (req, res) => {
    const { email, name, password, plan } = req.body as {
      email: string; name: string; password: string; plan?: PlanName;
    };

    try {
      const user  = await registerUser(email, name, password, plan ?? 'free');
      const token = signToken({ userId: user.id, email: user.email, plan: user.plan });
      logger.info('auth', `Registered ${email} on ${user.plan} plan`);
      res.status(201).json({ token, user: publicUser(user) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      res.status(409).json({ error: msg });
    }
  }
);

// POST /auth/login
authRouter.post(
  '/login',
  authLimiter,
  validate({
    email:    { type: 'string', required: true },
    password: { type: 'string', required: true },
  }),
  async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const user = await loginUser(email, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, plan: user.plan });
    logger.info('auth', `Login ${email}`);
    res.json({ token, user: publicUser(user) });
  }
);

// GET /auth/me — fresh user data (credits, plan) from store, not the stale JWT claim
authRouter.get('/me', authenticate, (req: AuthRequest, res) => {
  const user = store.users.findById(req.user!.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ user: publicUser(user) });
});
