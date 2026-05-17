// Tool Registry — all AI tools register here. The orchestrator looks them up by name.

export interface ToolParams {
  prompt:       string;
  provider:     string;
  style?:       string;
  aspectRatio?: string;
  seed?:        number;
  systemPrompt?: string;
  [key: string]: unknown;
}

export interface ToolResult {
  type:       'image' | 'text';
  content:    string;          // base64 data-URL for images, plain text for text
  provider:   string;
  model:      string;
  metadata?:  Record<string, unknown>;
}

export interface ToolDefinition {
  name:        string;
  description: string;
  cost:        number;         // credits per call
  handler:     (p: ToolParams) => Promise<ToolResult>;
}

const _registry = new Map<string, ToolDefinition>();

export const toolRegistry = {
  register(t: ToolDefinition): void  { _registry.set(t.name, t); },
  get(name: string)                  { return _registry.get(name); },
  has(name: string): boolean         { return _registry.has(name); },
  list(): ToolDefinition[]           { return [..._registry.values()]; },
};
