import { Router }             from 'express';
import { agentLimiter }       from '../middleware/rateLimiter.js';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { validate }           from '../middleware/validate.js';
import { runAgent }           from '../agents/orchestrator.js';
import { agentMemory }        from '../agents/memory.js';
import { runReAct }           from '../agents/react.js';
import { runMultiAgent }      from '../agents/multiAgent.js';
import { runFullOrchestration } from '../agents/fullOrchestrator.js';
import { sharedMemory }       from '../memory/sharedMemory.js';
import type { Role }          from '../governance/permissions.js';

export const agentRouter = Router();

const PLAN_TO_ROLE: Record<string, Role> = {
  free: 'user', user: 'user', pro: 'pro', enterprise: 'admin', admin: 'admin',
};

// POST /agent/run
// Flow: JWT auth → IP rate limit → validation → orchestrator
agentRouter.post(
  '/run',
  agentLimiter,
  authenticate,
  validate({
    task:   { type: 'string', required: true, oneOf: ['image', 'text', 'auto'] },
    prompt: { type: 'string', required: true, minLen: 3, maxLen: 4000 },
  }),
  async (req: AuthRequest, res) => {
    const { task, prompt, options } = req.body as {
      task:    'image' | 'text' | 'auto';
      prompt:  string;
      options?: {
        style?:        string;
        aspectRatio?:  string;
        seed?:         number;
        systemPrompt?: string;
      };
    };

    const response = await runAgent({
      userId: req.user!.id,
      task,
      prompt,
      options,
    });

    const status = response.success
      ? 200
      : response.error?.includes('credit')    ? 402
      : response.error?.includes('throttled') ? 429
      : 422;
    res.status(status).json(response);
  }
);

// GET /agent/memory  — view this user's recent conversation context
agentRouter.get('/memory', authenticate, (req: AuthRequest, res) => {
  const entries = agentMemory.get(req.user!.id);
  res.json({ count: entries.length, entries });
});

// DELETE /agent/memory  — clear this user's conversation context
agentRouter.delete('/memory', authenticate, (req: AuthRequest, res) => {
  agentMemory.clear(req.user!.id);
  res.json({ cleared: true });
});

// POST /agent/react  — run the full ReAct (Think→Act→Observe) loop
agentRouter.post(
  '/react',
  agentLimiter,
  authenticate,
  validate({
    task:     { type: 'string', required: true, minLen: 3, maxLen: 4000 },
    maxSteps: { type: 'number', required: false },
  }),
  async (req: AuthRequest, res) => {
    const { task, maxSteps = 5 } = req.body as { task: string; maxSteps?: number };
    const result = await runReAct(req.user!.id, task, Math.min(Math.max(Number(maxSteps) || 5, 1), 10));
    // Return 200 whenever there is any result content — 422 only for truly empty responses.
    // The frontend reads result.success and step statuses to determine UI state.
    const hasContent = (result.steps?.length ?? 0) > 0 || result.finalAnswer?.trim();
    const status = hasContent ? 200 : result.error?.includes('credit') ? 402 : 422;
    res.status(status).json(result);
  }
);

// POST /agent/multi  — Planner → Workers multi-agent pipeline
// Body: { task: string, options?: { style?, aspectRatio?, seed? } }
agentRouter.post(
  '/multi',
  agentLimiter,
  authenticate,
  validate({
    task: { type: 'string', required: true, minLen: 3, maxLen: 4000 },
  }),
  async (req: AuthRequest, res) => {
    const { task, options } = req.body as {
      task:     string;
      options?: { style?: string; aspectRatio?: string; seed?: number };
    };
    const result = await runMultiAgent(req.user!.id, task, options);
    const hasContent = (result.stepResults?.length ?? 0) > 0 || result.finalAnswer?.trim();
    const status = hasContent ? 200 : result.error?.includes('credit') ? 402 : 422;
    res.status(status).json(result);
  }
);

// POST /agent/orchestrate  — Full 8-agent orchestration with governance + supervision
agentRouter.post(
  '/orchestrate',
  agentLimiter,
  authenticate,
  validate({
    task: { type: 'string', required: true, minLen: 3, maxLen: 4000 },
  }),
  async (req: AuthRequest, res) => {
    const { task, options } = req.body as {
      task:     string;
      options?: {
        style?:       string;
        aspectRatio?: string;
        seed?:        number;
        maxSteps?:    number;
        depth?:       'quick' | 'standard' | 'deep';
        supervise?:   boolean;
      };
    };
    const result = await runFullOrchestration({
      userId:   req.user!.id,
      userRole: PLAN_TO_ROLE[req.user!.plan] ?? 'user',
      task,
      options,
    });
    const hasContent = (result.stepResults?.length ?? 0) > 0 || result.finalAnswer?.trim();
    const status = hasContent ? 200 : result.error?.includes('credit') ? 402 : result.stoppedBy === 'governance' ? 403 : 422;
    res.status(status).json(result);
  }
);

// GET /agent/session/:id  — inspect a running or completed multi-agent session
agentRouter.get('/session/:id', authenticate, (req: AuthRequest, res) => {
  const session = sharedMemory.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (session.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
  res.json(session);
});
