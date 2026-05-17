export interface ToolDefinition {
  name: string;
  description: string;
  requiredPermissions?: string[];
  allowedRoles?: string[];
  sandbox?: boolean;
  maxCallsPerTask?: number;
  requiresApproval?: boolean;
}

export interface VisibilityContext {
  role?: string;
  userId?: string;
  taskId?: string;
  permissions?: string[];
}

export class ToolVisibilityEngine {
  private tools     = new Map<string, ToolDefinition>();
  private callCounts = new Map<string, number>(); // `${taskId}:${toolName}` → count

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  getVisibleTools(ctx: VisibilityContext): ToolDefinition[] {
    return [...this.tools.values()].filter(tool => {
      if (tool.allowedRoles?.length && ctx.role && !tool.allowedRoles.includes(ctx.role)) return false;
      if (tool.requiredPermissions?.length && ctx.permissions) {
        if (!tool.requiredPermissions.every(p => ctx.permissions!.includes(p))) return false;
      }
      return true;
    });
  }

  canCall(toolName: string, ctx: VisibilityContext): { allowed: boolean; reason?: string } {
    const tool = this.tools.get(toolName);
    if (!tool) return { allowed: false, reason: `Tool "${toolName}" not registered` };

    if (tool.allowedRoles?.length && ctx.role && !tool.allowedRoles.includes(ctx.role)) {
      return { allowed: false, reason: `Role "${ctx.role}" cannot access tool "${toolName}"` };
    }

    if (tool.requiredPermissions?.length && ctx.permissions) {
      const missing = tool.requiredPermissions.filter(p => !ctx.permissions!.includes(p));
      if (missing.length) {
        return { allowed: false, reason: `Missing permissions: ${missing.join(', ')}` };
      }
    }

    if (tool.maxCallsPerTask && ctx.taskId) {
      const key   = `${ctx.taskId}:${toolName}`;
      const count = this.callCounts.get(key) ?? 0;
      if (count >= tool.maxCallsPerTask) {
        return {
          allowed: false,
          reason: `Tool "${toolName}" reached max calls per task (${tool.maxCallsPerTask})`,
        };
      }
    }

    return { allowed: true };
  }

  recordCall(toolName: string, taskId: string): void {
    const key = `${taskId}:${toolName}`;
    this.callCounts.set(key, (this.callCounts.get(key) ?? 0) + 1);
  }

  resetTaskCounts(taskId: string): void {
    for (const key of [...this.callCounts.keys()]) {
      if (key.startsWith(`${taskId}:`)) this.callCounts.delete(key);
    }
  }

  getAll(): ToolDefinition[] { return [...this.tools.values()]; }
  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }
}

export const toolVisibility = new ToolVisibilityEngine();
