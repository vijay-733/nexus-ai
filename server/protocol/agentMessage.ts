export type AgentRole =
  | 'planner' | 'text' | 'image' | 'research' | 'memory' | 'supervisor' | 'worker' | 'orchestrator';

export interface AgentContext {
  memory?:        Record<string, unknown>;
  history?:       Array<{ role: string; content: string }>;
  workflowId?:    string;
  parentAgentId?: string;
  depth?:         number;
  checkpointId?:  string;
}

export interface AgentConstraints {
  maxTokens?:      number;
  timeoutMs?:      number;
  allowedTools?:   string[];
  forbiddenTools?: string[];
  outputFormat?:   'text' | 'json' | 'markdown';
  maxSteps?:       number;
}

export interface AgentMessage<P = unknown> {
  id: string;
  from: AgentRole;
  to: AgentRole | 'broadcast';
  type: 'request' | 'response' | 'event' | 'error';
  correlationId?: string;
  taskId?:        string;
  userId?:        string;
  payload:        P;
  context?:       AgentContext;
  constraints?:   AgentConstraints;
  timestamp:      number;
}

export interface AgentRequest extends AgentMessage {
  type: 'request';
  payload: {
    task:       string;
    input:      unknown;
    priority?:  'low' | 'normal' | 'high';
  };
}

export interface AgentResponse extends AgentMessage {
  type: 'response';
  payload: {
    output:       unknown;
    success:      boolean;
    error?:       string;
    tokenCount?:  number;
    latencyMs?:   number;
  };
}

export interface AgentError extends AgentMessage {
  type: 'error';
  payload: {
    code:    string;
    message: string;
    details?: unknown;
  };
}
