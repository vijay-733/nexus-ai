// Agent Orchestrator
// Flow: request → tool detection → credit check → provider selection → tool run → usage record → response

import { toolRegistry, type ToolResult }      from '../tools/registry.js';
import { checkCredits, recordUsage }           from '../services/usageTracker.js';
import { resolveProviders }                    from '../services/modelRouter.js';
import { store }                               from '../utils/store.js';
import { logger }                              from '../utils/logger.js';
import type { PlanName }                       from '../utils/config.js';
import { agentMemory }                         from './memory.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskType = 'image' | 'text' | 'auto';

export interface AgentRequest {
  userId:  string;
  task:    TaskType;
  prompt:  string;
  options?: {
    style?:        string;
    aspectRatio?:  string;
    seed?:         number;
    systemPrompt?: string;
    model?:        string;
  };
}

export interface AgentResponse {
  success:     boolean;
  requestId:   string;
  tool:        string;
  result?:     ToolResult;
  error?:      string;
  usage: {
    creditsUsed:      number;
    creditsRemaining: number;
    plan:             string;
  };
  memoryUsed:  number;   // number of memory entries included as context
  durationMs:  number;
}

// ── Keyword-based tool auto-detection ────────────────────────────────────────

const IMAGE_KEYWORDS = [
  'image', 'photo', 'picture', 'draw', 'paint', 'generate a visual',
  'illustration', 'artwork', 'render', 'painting', 'photograph', 'portrait',
  'landscape', 'design a', 'create a logo', 'icon', 'wallpaper', 'banner',
  'thumbnail', 'sketch', 'visualize', 'show me',
];

function detectTool(prompt: string): 'image-generation' | 'text-generation' {
  const lower = prompt.toLowerCase();
  return IMAGE_KEYWORDS.some(kw => lower.includes(kw)) ? 'image-generation' : 'text-generation';
}

function taskToTool(task: TaskType, prompt: string): string {
  if (task === 'image') return 'image-generation';
  if (task === 'text')  return 'text-generation';
  return detectTool(prompt);    // auto
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runAgent(req: AgentRequest): Promise<AgentResponse> {
  const t0      = Date.now();
  const toolName = taskToTool(req.task, req.prompt);

  logger.info('orchestrator', `user=${req.userId} task=${req.task} → tool=${toolName}`);

  // 1 ── Credit & throttle check ──────────────────────────────────────────────
  const check = checkCredits(req.userId, toolName);
  if (!check.allowed) {
    const record = recordUsage(req.userId, toolName, 'none', 'blocked', Date.now() - t0, req.prompt);
    const user   = store.users.findById(req.userId)!;
    return {
      success: false, requestId: record.id, tool: toolName, error: check.reason,
      usage: { creditsUsed: 0, creditsRemaining: user.credits, plan: user.plan },
      memoryUsed: 0, durationMs: Date.now() - t0,
    };
  }

  // 2 ── Resolve tool ─────────────────────────────────────────────────────────
  const tool = toolRegistry.get(toolName);
  if (!tool) {
    const user = store.users.findById(req.userId)!;
    return {
      success: false, requestId: 'err', tool: toolName,
      error:  `Tool '${toolName}' not registered.`,
      usage:  { creditsUsed: 0, creditsRemaining: user.credits, plan: user.plan },
      memoryUsed: 0, durationMs: Date.now() - t0,
    };
  }

  // 3 ── Select provider for this user's plan ─────────────────────────────────
  const user      = store.users.findById(req.userId)!;
  const providers = resolveProviders(user.plan as PlanName);
  const provider  = toolName === 'image-generation' ? providers.image : providers.text;

  // 4 ── Load memory & inject context for text requests ──────────────────────
  const memory     = agentMemory.get(req.userId);
  let   toolOptions = { ...(req.options ?? {}) };

  if (toolName === 'text-generation' && memory.length > 0) {
    // Append last 6 memory entries (3 exchanges) as conversation context
    const historyBlock = memory
      .slice(-6)
      .map(e => `${e.role === 'user' ? 'Human' : 'Assistant'}: ${e.content}`)
      .join('\n');
    const baseSystem = (req.options?.systemPrompt as string | undefined) ?? '';
    toolOptions = {
      ...toolOptions,
      systemPrompt: baseSystem
        ? `${baseSystem}\n\n--- Conversation context ---\n${historyBlock}`
        : `Conversation context:\n${historyBlock}`,
    };
    logger.debug('orchestrator', `memory context: ${memory.length} entries injected`);
  }

  // 5 ── Execute tool ─────────────────────────────────────────────────────────
  let result: ToolResult | undefined;
  let status: 'success' | 'failed' = 'failed';
  let errorMsg: string | undefined;

  try {
    result = await tool.handler({ prompt: req.prompt, provider, ...toolOptions });
    status = 'success';
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : 'Tool execution failed';
    logger.error('orchestrator', `${toolName} failed`, errorMsg);
  }

  // 6 ── Save turn to memory (text only, on success) ─────────────────────────
  if (status === 'success' && result) {
    agentMemory.push(req.userId, {
      role: 'user', content: req.prompt.slice(0, 500), tool: toolName, timestamp: Date.now(),
    });
    if (result.type === 'text') {
      agentMemory.push(req.userId, {
        role: 'assistant', content: result.content.slice(0, 500), tool: toolName, timestamp: Date.now(),
      });
    }
  }

  // 7 ── Record usage & deduct credits ───────────────────────────────────────
  const durationMs  = Date.now() - t0;
  const usageRec    = recordUsage(req.userId, toolName, provider, status, durationMs, req.prompt);
  const updatedUser = store.users.findById(req.userId)!;

  return {
    success:    status === 'success',
    requestId:  usageRec.id,
    tool:       toolName,
    result,
    error:      errorMsg,
    usage: {
      creditsUsed:      usageRec.creditsUsed,
      creditsRemaining: updatedUser.credits,
      plan:             updatedUser.plan,
    },
    memoryUsed:  memory.length,
    durationMs,
  };
}
