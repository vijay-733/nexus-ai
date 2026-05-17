import { globalEventBus }   from '../events/eventBus.js';
import { policyEngine }     from '../governance/policyEngine.js';
import { hasPermission }    from '../governance/permissions.js';
import { buildSystemPrompt } from '../context/promptTemplates.js';
import { auditLog }         from '../db/migrate.js';
import { logger }           from '../utils/logger.js';
import type { Role }        from '../governance/permissions.js';

const emit = globalEventBus.createEmitter('governance-agent');

export interface GovernanceRequest {
  userId:      string;
  userRole:    Role;
  action:      string;
  resource:    string;
  resourceId?: string;
  toolName?:   string;
}

export interface GovernanceResult {
  allowed:          boolean;
  reason:           string;
  riskLevel:        'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
}

const HIGH_RISK_TOOLS  = new Set(['web-fetch', 'memory-delete', 'image-generation']);
const CRITICAL_ACTIONS = new Set(['bulk-delete', 'admin-override', 'key-rotate', 'user-delete']);

export class GovernanceAgent {
  async validate(req: GovernanceRequest): Promise<GovernanceResult> {
    const { userId, userRole, action, resource, toolName } = req;

    // 1 — RBAC: check permission via hasPermission
    const permission = this.mapActionToPermission(action);
    const hasAccess  = permission ? hasPermission(userRole, permission) : true;

    if (!hasAccess) {
      emit('GOVERNANCE_DENIED', { userId, action, resource, reason: 'RBAC_DENIED' }, { userId });
      await auditLog(userId, action, resource, req.resourceId, 'denied', { reason: 'RBAC_DENIED', role: userRole });
      return {
        allowed:          false,
        reason:           `Role "${userRole}" does not have permission to "${action}" on "${resource}"`,
        riskLevel:        'medium',
        requiresApproval: false,
      };
    }

    // 2 — Policy engine check
    const policyResult = policyEngine.evaluate({ userId, role: userRole, action, resource });

    if (!policyResult.allowed) {
      emit('GOVERNANCE_DENIED', { userId, action, resource, reason: policyResult.reason }, { userId });
      await auditLog(userId, action, resource, req.resourceId, 'denied', { reason: policyResult.reason });
      return {
        allowed:          false,
        reason:           policyResult.reason,
        riskLevel:        'high',
        requiresApproval: false,
      };
    }

    // 3 — Risk assessment
    const riskLevel        = this.assessRisk(action, toolName, userRole);
    const requiresApproval = riskLevel === 'critical' || CRITICAL_ACTIONS.has(action);

    emit('GOVERNANCE_CHECKED', { userId, action, resource, riskLevel, allowed: true }, { userId });
    await auditLog(userId, action, resource, req.resourceId, 'allowed', { riskLevel, toolName });

    return { allowed: true, reason: 'All governance checks passed', riskLevel, requiresApproval };
  }

  private mapActionToPermission(action: string): import('../governance/permissions.js').Permission | null {
    if (action.startsWith('agent:'))      return 'agent:run';
    if (action.startsWith('tool:'))       return 'tool:execute';
    if (action.startsWith('memory:'))     return 'memory:read';
    if (action === 'agent:run')           return 'agent:run';
    if (action === 'task:create')         return 'task:create';
    return null;
  }

  private assessRisk(action: string, toolName?: string, role?: Role): GovernanceResult['riskLevel'] {
    if (CRITICAL_ACTIONS.has(action))              return 'critical';
    if (HIGH_RISK_TOOLS.has(toolName ?? ''))       return 'high';
    if (role === 'guest')                          return 'medium';
    if (action.includes('delete'))                 return 'high';
    if (action.includes('write') || action.includes('update')) return 'medium';
    return 'low';
  }

  async validateToolCall(userId: string, userRole: Role, toolName: string): Promise<GovernanceResult> {
    return this.validate({ userId, userRole, action: `tool:${toolName}`, resource: 'tools', toolName });
  }

  async validateAgentOp(userId: string, userRole: Role, operation: string): Promise<GovernanceResult> {
    return this.validate({ userId, userRole, action: operation, resource: 'agent' });
  }

  getSystemPrompt(userId: string, taskId: string): string {
    return buildSystemPrompt('governance', { userId, taskId });
  }
}

export const governanceAgent = new GovernanceAgent();
