export type NodeStatus     = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowNode {
  id: string;
  name: string;
  type: 'agent' | 'tool' | 'decision' | 'join' | 'fork';
  agentName?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  status: NodeStatus;
  dependencies: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
  retries: number;
  maxRetries: number;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  nodes: WorkflowNode[];
  userId?: string;
  taskId?: string;
  input: unknown;
  output?: unknown;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  metadata: Record<string, unknown>;
}
