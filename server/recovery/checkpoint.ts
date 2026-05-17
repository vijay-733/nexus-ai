export type CheckpointPhase = 'planning' | 'executing' | 'tool_call' | 'synthesizing';

export interface ExecutionCheckpoint {
  id: string;
  taskId: string;
  agentId?: string;
  step: number;
  totalSteps?: number;
  phase: CheckpointPhase;
  state: {
    messages: Array<{ role: string; content: string }>;
    plan?: unknown;
    toolOutputs: Record<string, unknown>;
    memorySnapshot: Record<string, unknown>;
    variables: Record<string, unknown>;
  };
  metadata: {
    userId?: string;
    correlationId?: string;
    startedAt: number;
    lastUpdatedAt: number;
    retryCount: number;
    failureReason?: string;
  };
  createdAt: number;
  expiresAt?: number;
}

export interface RecoveryContext {
  checkpoint: ExecutionCheckpoint;
  resumeFrom: 'last_step' | 'last_tool' | 'plan_start';
  injectedContext?: string;
}
