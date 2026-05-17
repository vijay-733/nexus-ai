export type Role = 'admin' | 'pro' | 'user' | 'guest';

export type Permission =
  | 'agent:run' | 'agent:manage' | 'agent:terminate'
  | 'task:create' | 'task:read' | 'task:cancel'
  | 'memory:read' | 'memory:write' | 'memory:delete' | 'memory:admin'
  | 'tool:execute' | 'tool:manage'
  | 'model:standard' | 'model:advanced' | 'model:manage'
  | 'governance:read' | 'governance:write' | 'governance:admin'
  | 'observability:read' | 'observability:admin'
  | 'system:admin' | 'system:read'
  | 'approval:grant' | 'approval:request';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'agent:run', 'agent:manage', 'agent:terminate',
    'task:create', 'task:read', 'task:cancel',
    'memory:read', 'memory:write', 'memory:delete', 'memory:admin',
    'tool:execute', 'tool:manage',
    'model:standard', 'model:advanced', 'model:manage',
    'governance:read', 'governance:write', 'governance:admin',
    'observability:read', 'observability:admin',
    'system:admin', 'system:read',
    'approval:grant', 'approval:request',
  ],
  pro: [
    'agent:run', 'task:create', 'task:read', 'task:cancel',
    'memory:read', 'memory:write',
    'tool:execute',
    'model:standard', 'model:advanced',
    'governance:read',
    'observability:read',
    'system:read',
    'approval:request',
  ],
  user: [
    'agent:run', 'task:create', 'task:read', 'task:cancel',
    'memory:read', 'memory:write',
    'tool:execute',
    'model:standard',
    'system:read',
    'approval:request',
  ],
  guest: [
    'task:read',
    'memory:read',
    'system:read',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getPermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
