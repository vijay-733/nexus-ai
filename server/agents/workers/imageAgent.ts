// Image Worker Agent
// Executes one image-generation step by delegating to the tool registry.
// This keeps the worker thin — all provider logic lives in the registered tool.

import { toolRegistry }     from '../../tools/registry.js';
import { resolveProviders } from '../../services/modelRouter.js';
import { store }            from '../../utils/store.js';
import { logger }           from '../../utils/logger.js';
import type { PlanName }    from '../../utils/config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImageAgentInput {
  stepId:       string;
  task:         string;
  context:      string;   // built by sharedMemory.buildContext() — prior step outputs
  userId:       string;   // needed to resolve provider from user's plan
  style?:       string;
  aspectRatio?: string;
  seed?:        number;
}

export interface ImageAgentOutput {
  stepId:     string;
  content:    string;    // data-URL (base64) or empty string on failure
  provider:   string;
  durationMs: number;
  error?:     string;
}

// ── Execution ─────────────────────────────────────────────────────────────────

export async function runImageAgent(input: ImageAgentInput): Promise<ImageAgentOutput> {
  const t0   = Date.now();
  const user = store.users.findById(input.userId);

  if (!user) {
    return { stepId: input.stepId, content: '', provider: 'none', durationMs: 0, error: 'User not found' };
  }

  const providers = resolveProviders(user.plan as PlanName);
  const tool      = toolRegistry.get('image-generation');

  if (!tool) {
    return { stepId: input.stepId, content: '', provider: 'none', durationMs: 0, error: 'image-generation tool not registered' };
  }

  // Enrich the prompt with context from prior steps (e.g. text description → image)
  const enrichedPrompt = input.context
    ? `${input.task}\n\nContext: ${input.context.slice(0, 400)}`
    : input.task;

  logger.info('image-agent', `[${input.stepId}] provider=${providers.image} task="${input.task.slice(0, 80)}"`);

  try {
    const result = await tool.handler({
      prompt:      enrichedPrompt,
      provider:    providers.image,
      style:       input.style,
      aspectRatio: input.aspectRatio ?? '1:1',
      seed:        input.seed ?? Math.floor(Math.random() * 99_999),
    });

    logger.info('image-agent', `[${input.stepId}] done provider=${result.provider}`);
    return {
      stepId:     input.stepId,
      content:    result.content,
      provider:   result.provider,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image agent execution failed';
    logger.error('image-agent', `[${input.stepId}] ${msg}`);
    return { stepId: input.stepId, content: '', provider: providers.image, durationMs: Date.now() - t0, error: msg };
  }
}
