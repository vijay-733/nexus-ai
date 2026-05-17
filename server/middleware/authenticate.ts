import { Request, Response, NextFunction } from 'express';
import { verifyToken }   from '../utils/jwt.js';
import { store }         from '../utils/store.js';
import { logger }        from '../utils/logger.js';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; plan: string };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing. Expected: Bearer <token>' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    const user    = store.users.findById(payload.userId);
    if (!user) {
      res.status(401).json({ error: 'Token references a deleted account. Please re-register.' });
      return;
    }
    req.user = { id: user.id, email: user.email, plan: user.plan };
    next();
  } catch (err) {
    logger.warn('auth', 'JWT rejected', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Invalid or expired token. Log in again to get a fresh token.' });
  }
}
