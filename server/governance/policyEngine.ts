import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';
import type { Role, Permission } from './permissions.js';
import { hasPermission } from './permissions.js';

export interface PolicyCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'in' | 'contains';
  value: unknown;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  effect: 'allow' | 'deny';
  conditions: PolicyCondition[];
  createdAt: number;
}

export interface PolicyContext {
  userId?: string;
  role?: Role;
  action?: string;
  resource?: string;
  inputLength?: number;
  requestsInLastHour?: number;
  metadata?: Record<string, unknown>;
}

export interface PolicyResult {
  allowed: boolean;
  reason: string;
  policyId?: string;
  policyName?: string;
}

const DEFAULT_POLICIES: Policy[] = [
  {
    id: 'max-input-length',
    name: 'Max Input Length',
    description: 'Deny requests with input longer than 4000 characters',
    priority: 100,
    enabled: true,
    effect: 'deny',
    conditions: [{ field: 'inputLength', operator: 'gt', value: 4000 }],
    createdAt: Date.now(),
  },
  {
    id: 'rate-limit',
    name: 'Rate Limit',
    description: 'Deny if user exceeds 100 requests per hour',
    priority: 90,
    enabled: true,
    effect: 'deny',
    conditions: [{ field: 'requestsInLastHour', operator: 'gt', value: 100 }],
    createdAt: Date.now(),
  },
];

const emit = globalEventBus.createEmitter('policy-engine');

export class PolicyEngine {
  private policies: Policy[] = [...DEFAULT_POLICIES];

  add(policy: Omit<Policy, 'id' | 'createdAt'>): Policy {
    const p: Policy = { ...policy, id: randomUUID(), createdAt: Date.now() };
    this.policies.push(p);
    this.policies.sort((a, b) => b.priority - a.priority);
    return p;
  }

  remove(id: string): boolean {
    const idx = this.policies.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.policies.splice(idx, 1);
    return true;
  }

  update(id: string, patch: Partial<Omit<Policy, 'id' | 'createdAt'>>): Policy | null {
    const p = this.policies.find(p => p.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    this.policies.sort((a, b) => b.priority - a.priority);
    return p;
  }

  list(): Policy[] { return [...this.policies]; }

  evaluate(ctx: PolicyContext, requiredPermission?: Permission): PolicyResult {
    if (requiredPermission && ctx.role) {
      if (!hasPermission(ctx.role, requiredPermission)) {
        const result: PolicyResult = {
          allowed: false,
          reason: `Role "${ctx.role}" lacks permission "${requiredPermission}"`,
        };
        emit('GOVERNANCE_DENIED', { ctx, result });
        return result;
      }
    }

    for (const policy of this.policies) {
      if (!policy.enabled) continue;
      if (this.matchesConditions(ctx, policy.conditions)) {
        const allowed = policy.effect === 'allow';
        const result: PolicyResult = {
          allowed,
          reason:     policy.description,
          policyId:   policy.id,
          policyName: policy.name,
        };
        emit(allowed ? 'GOVERNANCE_CHECKED' : 'GOVERNANCE_DENIED', { ctx, result });
        return result;
      }
    }

    emit('GOVERNANCE_CHECKED', { ctx, result: { allowed: true, reason: 'No matching policy — default allow' } });
    return { allowed: true, reason: 'No matching policy — default allow' };
  }

  private matchesConditions(ctx: PolicyContext, conditions: PolicyCondition[]): boolean {
    const flat: Record<string, unknown> = { ...ctx, ...ctx.metadata };
    return conditions.every(c => {
      const val = flat[c.field];
      switch (c.operator) {
        case 'eq':       return val === c.value;
        case 'neq':      return val !== c.value;
        case 'gt':       return typeof val === 'number' && val > (c.value as number);
        case 'lt':       return typeof val === 'number' && val < (c.value as number);
        case 'in':       return Array.isArray(c.value) && c.value.includes(val);
        case 'contains': return typeof val === 'string' && val.includes(String(c.value));
        default:         return false;
      }
    });
  }
}

export const policyEngine = new PolicyEngine();
