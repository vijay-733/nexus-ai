import type { Request, Response, NextFunction } from 'express';
import { policyEngine, type PolicyContext } from './policyEngine.js';
import type { Permission, Role } from './permissions.js';

export interface AuthRequest extends Request {
  user?: { id: string; role: Role };
}

export function requirePermission(permission: Permission) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role   = req.user?.role ?? 'guest';
    const result = policyEngine.evaluate({ userId: req.user?.id, role }, permission);
    if (!result.allowed) {
      res.status(403).json({ error: 'Forbidden', reason: result.reason });
      return;
    }
    next();
  };
}

export function checkPolicy(contextBuilder?: (req: AuthRequest) => Partial<PolicyContext>) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const base: PolicyContext = { userId: req.user?.id, role: req.user?.role ?? 'guest' };
    const ctx  = contextBuilder ? { ...base, ...contextBuilder(req) } : base;
    const result = policyEngine.evaluate(ctx);
    if (!result.allowed) {
      res.status(403).json({ error: 'Forbidden', reason: result.reason, policyId: result.policyId });
      return;
    }
    next();
  };
}
