export type ModelCapability = 'chat' | 'completion' | 'image' | 'embedding' | 'vision';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  capabilities?: ModelCapability[];
  userId?: string;
  taskId?: string;
}

export interface ModelResponse {
  content: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  finishReason?: string;
}

export interface ModelProvider {
  name: string;
  priority: number;
  capabilities: ModelCapability[];
  isAvailable(): Promise<boolean>;
  complete(request: ModelRequest): Promise<ModelResponse>;
}
