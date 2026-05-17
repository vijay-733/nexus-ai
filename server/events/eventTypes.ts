import { randomUUID } from 'crypto';

export type EventType =
  | 'TASK_CREATED' | 'TASK_STARTED' | 'TASK_COMPLETED' | 'TASK_FAILED' | 'TASK_CANCELLED'
  | 'AGENT_STARTED' | 'AGENT_STEP' | 'AGENT_COMPLETED' | 'AGENT_FAILED'
  | 'TOOL_CALLED' | 'TOOL_COMPLETED' | 'TOOL_FAILED'
  | 'PLAN_CREATED' | 'PLAN_STEP_STARTED' | 'PLAN_STEP_COMPLETED'
  | 'MEMORY_READ' | 'MEMORY_WRITTEN' | 'MEMORY_DELETED'
  | 'GOVERNANCE_CHECKED' | 'GOVERNANCE_DENIED' | 'APPROVAL_REQUESTED' | 'APPROVAL_GRANTED' | 'APPROVAL_DENIED'
  | 'MODEL_ROUTED' | 'MODEL_FALLBACK' | 'MODEL_FAILED'
  | 'HEALTH_ALERT' | 'TOOL_TIMEOUT'
  | 'RECOVERY_TRIGGERED' | 'CHECKPOINT_SAVED' | 'CHECKPOINT_RESTORED'
  | 'CONTEXT_BUILT' | 'SAFETY_VIOLATION'
  | 'RETRY_TRIGGERED' | 'WORKFLOW_STARTED' | 'WORKFLOW_COMPLETED' | 'WORKFLOW_FAILED'
  | 'CREDITS_DEDUCTED' | 'QUOTA_EXCEEDED' | 'PLAN_UPGRADED'
  | 'SYSTEM_STARTED' | 'SYSTEM_ERROR';

export interface AgentEvent<P = unknown> {
  id: string;
  type: EventType;
  timestamp: number;
  source: string;
  payload: P;
  correlationId?: string;
  userId?: string;
  taskId?: string;
  agentId?: string;
}

export function createEvent<P>(
  type: EventType,
  source: string,
  payload: P,
  extra?: Partial<Pick<AgentEvent, 'correlationId' | 'userId' | 'taskId' | 'agentId'>>
): AgentEvent<P> {
  return {
    id: randomUUID(),
    type,
    timestamp: Date.now(),
    source,
    payload,
    ...extra,
  };
}
