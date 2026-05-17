// SSE streaming routes — real-time step-by-step agent execution.
//
// Endpoints (POST, JWT in Authorization header):
//   POST /stream/react        — ReAct loop, streams each step as it completes
//   POST /stream/multi        — Multi-agent pipeline, streams plan + each step
//   POST /stream/orchestrate  — Full orchestrator, streams plan + each step
//
// Event format (newline-delimited SSE):
//   data: {"type":"plan","plan":[...]}\n\n
//   data: {"type":"step","step":{...}}\n\n
//   data: {"type":"done","result":{...}}\n\n
//   data: {"type":"error","error":"..."}\n\n
//
// Client side: use fetch() with response.body stream reader (not native EventSource,
// which is GET-only and can't send Authorization headers).

import { Router, type Response }      from 'express';
import { agentLimiter }               from '../middleware/rateLimiter.js';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { validate }                   from '../middleware/validate.js';
import { runReAct }                   from '../agents/react.js';
import { runMultiAgent }              from '../agents/multiAgent.js';
import { runFullOrchestration }       from '../agents/fullOrchestrator.js';
import type { Role }                  from '../governance/permissions.js';

export const streamRouter = Router();

const PLAN_TO_ROLE: Record<string, Role> = {
  free: 'user', user: 'user', pro: 'pro', enterprise: 'admin', admin: 'admin',
};

function initSSE(res: Response): void {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
  res.flushHeaders();
}

function send(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// Heartbeat — sends a real SSE data event every 10s so Cloudflare / nginx / load
// balancers see active HTTP response data and don't close the connection.
// Uses a real JSON event (not a comment) because Cloudflare free tunnels ignore
// SSE comment lines (: ...) for their idle-connection timeout calculation.
function startHeartbeat(res: Response): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'heartbeat', ts: Date.now() })}\n\n`);
  }, 10_000);
}

// ── POST /stream/react ────────────────────────────────────────────────────────

streamRouter.post(
  '/react',
  agentLimiter,
  authenticate,
  validate({
    task:     { type: 'string', required: true, minLen: 3, maxLen: 4000 },
    maxSteps: { type: 'number', required: false },
  }),
  async (req: AuthRequest, res) => {
    const { task, maxSteps = 5 } = req.body as { task: string; maxSteps?: number };
    const safeMax = Math.min(Math.max(Number(maxSteps) || 5, 1), 10);

    initSSE(res);

    const ac        = new AbortController();
    const heartbeat = startHeartbeat(res);
    req.on('close', () => ac.abort());

    try {
      const result = await runReAct(
        req.user!.id,
        task,
        safeMax,
        ac.signal,
        {
          onStepStart: (stepNum, thought, action, actionInput) =>
            send(res, { type: 'step_start', stepNum, thought, action, actionInput }),
          onStep: step => send(res, { type: 'step', step }),
        },
      );
      send(res, { type: 'done', result });
    } catch (err) {
      send(res, { type: 'error', error: err instanceof Error ? err.message : 'Agent failed' });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  },
);

// ── POST /stream/multi ────────────────────────────────────────────────────────

streamRouter.post(
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

    initSSE(res);

    const ac        = new AbortController();
    const heartbeat = startHeartbeat(res);
    req.on('close', () => ac.abort());

    try {
      const result = await runMultiAgent(
        req.user!.id,
        task,
        options,
        ac.signal,
        {
          onPlan: plan => send(res, { type: 'plan', plan }),
          onStep: step => send(res, { type: 'step', step }),
        },
      );
      send(res, { type: 'done', result });
    } catch (err) {
      send(res, { type: 'error', error: err instanceof Error ? err.message : 'Agent failed' });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  },
);

// ── POST /stream/orchestrate ──────────────────────────────────────────────────

streamRouter.post(
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
        supervise?:   boolean;
      };
    };

    initSSE(res);

    const ac        = new AbortController();
    const heartbeat = startHeartbeat(res);
    req.on('close', () => ac.abort());

    try {
      const result = await runFullOrchestration({
        userId:     req.user!.id,
        userRole:   PLAN_TO_ROLE[req.user!.plan] ?? 'user',
        task,
        taskSignal: ac.signal,
        options,
        callbacks: {
          onPlan: plan => send(res, { type: 'plan', plan }),
          onStep: step => send(res, { type: 'step', step }),
        },
      });
      send(res, { type: 'done', result });
    } catch (err) {
      send(res, { type: 'error', error: err instanceof Error ? err.message : 'Agent failed' });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  },
);
