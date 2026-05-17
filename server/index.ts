import 'dotenv/config';
import express      from 'express';
import { existsSync }    from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { logger }   from './utils/logger.js';

// ── Validate critical env vars ────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET is not set in .env. Server cannot start.');
  process.exit(1);
}

// ── Register AI tools (side-effect imports — must run before routes) ──────────
import './tools/imageTool.js';
import './tools/textTool.js';
import './tools/researchTool.js';
import './tools/webTool.js';
import './tools/memoryTool.js';

// ── Routes ────────────────────────────────────────────────────────────────────
import { authRouter }   from './routes/auth.js';
import { agentRouter }  from './routes/agent.js';
import { usageRouter }  from './routes/usage.js';
import { toolsRouter }  from './routes/tools.js';
import { tasksRouter }  from './routes/tasks.js';
import { metricsRouter } from './routes/metrics.js';
import { generalLimiter } from './middleware/rateLimiter.js';

// ── Agent OS subsystems ───────────────────────────────────────────────────────
import { observabilityRouter } from './routes/observability.js';
import { governanceRouter }    from './routes/governance.js';
import { memoryRouter }        from './routes/memory.js';
import { healthRouter }        from './routes/health.js';
import { recoveryRouter }      from './routes/recovery.js';
import { workflowRouter }      from './routes/workflow.js';
import { billingRouter }       from './routes/billing.js';
import { queueRouter }         from './routes/queue.js';
import { streamRouter }        from './routes/stream.js';
import { authenticate }        from './middleware/authenticate.js';

// ── Core subsystem init ───────────────────────────────────────────────────────
import { initMemory }          from './memory/memoryManager.js';
import { structuredLogger }    from './observability/structuredLogger.js';
import { healthMonitor }       from './health/healthMonitor.js';
import { runMigrations }       from './db/migrate.js';
import { initRedisEventBus }   from './events/redisEventBus.js';

// ── Legacy provider helpers (kept for /api/* backward-compat with frontend) ───
import {
  callOpenAIImage, callStabilityImage, callPollinations,
} from './services/modelRouter.js';
import {
  STYLE_PROMPTS, OPENAI_SIZES, POLLINATIONS_DIMS,
} from './utils/config.js';

// ─────────────────────────────────────────────────────────────────────────────

const app  = express();
// Render sets PORT; local dev uses SERVER_PORT; fallback 3002
const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 3002);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Declared before the IIFE so signal handlers can reference the server instance
// that is assigned when app.listen() resolves inside the IIFE.
import { type Server } from 'http';
let _server: Server | null = null;

function gracefulShutdown(signal: string): void {
  logger.info('server', `${signal} received — graceful shutdown initiated`);
  if (_server) {
    _server.close(() => {
      logger.info('server', 'HTTP server closed');
      process.exit(0);
    });
    // Force-exit after 10 s if keep-alive connections stall the close
    setTimeout(() => {
      logger.warn('server', 'Forced exit after 10s shutdown timeout');
      process.exit(1);
    }, 10_000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('server', `Unhandled promise rejection: ${String(reason)}`);
});
process.on('uncaughtException', (err: Error) => {
  logger.error('server', `Uncaught exception: ${err.message}\n${err.stack ?? ''}`);
  gracefulShutdown('uncaughtException');
});

// Trust cloudflared / nginx proxy so req.ip reflects the real client IP.
// Without this, all tunnel traffic appears as 127.0.0.1, which breaks per-IP
// rate limiting (one user exhausts the shared loopback bucket).
app.set('trust proxy', 1);

// ── CORS — allow localhost dev ports and any Cloudflare/localtunnel origins ───
// Required when the browser accesses the app via a public tunnel URL and the
// frontend origin differs from the backend origin (e.g. two separate tunnels).
app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  const allowed =
    /^https?:\/\/localhost(:\d+)?$/.test(origin)    ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
    origin.endsWith('.trycloudflare.com')             ||
    origin.endsWith('.loca.lt')                       ||  // localtunnel
    origin.endsWith('.ngrok-free.app')                ||  // ngrok
    origin.endsWith('.ngrok.io')                      ||  // ngrok legacy
    origin.endsWith('.netlify.app')                   ||  // Netlify preview + production
    origin.endsWith('.onrender.com')                  ||  // Render preview
    (process.env.ALLOWED_ORIGIN ? origin === process.env.ALLOWED_ORIGIN : false); // custom domain
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin',      origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',     'Content-Type,Authorization,bypass-tunnel-reminder');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// Handle favicon before rate-limiting — prevents pointless 404s in browser consoles
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.json({ limit: '10mb' }));
app.use(generalLimiter);

// ── Core routes ───────────────────────────────────────────────────────────────
app.use('/auth',           authRouter);
app.use('/agent',          agentRouter);
app.use('/usage',          usageRouter);
app.use('/api/tools',      toolsRouter);
app.use('/tasks',          tasksRouter);

// ── Agent OS routes ───────────────────────────────────────────────────────────
app.use('/observability',  observabilityRouter);
app.use('/governance',     governanceRouter);
app.use('/memory',         memoryRouter);
app.use('/recovery',       recoveryRouter);
app.use('/workflow',       workflowRouter);
app.use('/billing',        authenticate, billingRouter);
app.use('/queue',          queueRouter);
app.use('/stream',         streamRouter);

// ── Observability ─────────────────────────────────────────────────────────────
app.use('/metrics',        metricsRouter);   // Prometheus scrape endpoint

// ── Legacy /api/* routes (used by React frontend) ────────────────────────────

function buildPrompt(prompt: string, style?: string): string {
  const suffix = style && STYLE_PROMPTS[style] ? `, ${STYLE_PROMPTS[style]}` : '';
  return `${prompt.trim()}${suffix}`;
}

const QUALITY_SCALE: Record<string, number> = { standard: 1, large: 1.5, ultra: 2 };

app.post('/api/generate-image', async (req, res) => {
  const { prompt, style, aspectRatio = '1:1', seed, quality = 'standard' } = req.body as {
    prompt?: string; style?: string; aspectRatio?: string; seed?: number; quality?: string;
  };
  if (!prompt?.trim()) { res.status(400).json({ error: 'Prompt is required' }); return; }

  const enhanced   = buildPrompt(prompt, style);
  const usedSeed   = seed ?? Math.floor(Math.random() * 999_999);
  const scale      = QUALITY_SCALE[quality] ?? 1;
  const openaiKey  = process.env.OPENAI_API_KEY?.trim();
  const stabilityKey = process.env.STABILITY_API_KEY?.trim();

  const pollinationsFallback = async (reason: string) => {
    logger.info('api', `Pollinations fallback — ${reason}`);
    const base = POLLINATIONS_DIMS[aspectRatio] ?? { w: 1024, h: 1024 };
    const w = Math.min(Math.round(base.w * scale / 64) * 64, 2048);
    const h = Math.min(Math.round(base.h * scale / 64) * 64, 2048);
    const image = await callPollinations(enhanced, w, h, usedSeed);
    res.json({ image, seed: usedSeed, provider: 'pollinations', warning: `Fallback: ${reason}` });
  };

  try {
    if (openaiKey) {
      const size = OPENAI_SIZES[aspectRatio] ?? '1024x1024';
      const { image, revisedPrompt } = await callOpenAIImage(enhanced, size, openaiKey);
      res.json({ image, seed: usedSeed, revisedPrompt, provider: 'openai' }); return;
    }
    if (stabilityKey) {
      const image = await callStabilityImage(enhanced, aspectRatio, usedSeed, stabilityKey);
      res.json({ image, seed: usedSeed, provider: 'stability' }); return;
    }
    const base  = POLLINATIONS_DIMS[aspectRatio] ?? { w: 1024, h: 1024 };
    const w = Math.min(Math.round(base.w * scale / 64) * 64, 2048);
    const h = Math.min(Math.round(base.h * scale / 64) * 64, 2048);
    const image = await callPollinations(enhanced, w, h, usedSeed);
    res.json({ image, seed: usedSeed, provider: 'pollinations' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Generation failed';
    const isAuth = msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('unauthorized');
    if (!isAuth && (openaiKey || stabilityKey)) {
      try { await pollinationsFallback(msg); return; } catch { /* fall through */ }
    }
    res.status(500).json({ error: msg });
  }
});

app.post('/api/enhance-prompt', async (req, res) => {
  const { prompt } = req.body as { prompt?: string };
  if (!prompt?.trim()) { res.status(400).json({ error: 'Prompt required' }); return; }
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) {
    res.json({ enhanced: `${prompt.trim()}, highly detailed, professional quality, masterpiece`, provider: 'local' });
    return;
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Enhance the image prompt. Return ONLY the enhanced prompt.' },
          { role: 'user',   content: prompt },
        ],
        max_tokens: 400,
      }),
    });
    const d = await r.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
    if (!r.ok) throw new Error(d.error?.message ?? 'Enhancement failed');
    res.json({ enhanced: d.choices?.[0]?.message?.content ?? prompt, provider: 'openai' });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/status', (_req, res) => {
  const hasOpenAI    = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasStability = Boolean(process.env.STABILITY_API_KEY?.trim());
  res.json({
    ok:            true,
    imageProvider: hasOpenAI ? 'openai' : hasStability ? 'stability' : 'pollinations',
    hasOpenAI, hasStability, freeMode: !hasOpenAI && !hasStability,
    agentSystem:   true,
  });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.get('/ping', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Static frontend (built dist/) ─────────────────────────────────────────────
const _dirname  = dirname(fileURLToPath(import.meta.url));
const _distPath = join(_dirname, '..', 'dist');
if (existsSync(_distPath)) {
  // Serve assets; add bypass header on HTML so Cloudflare quick-tunnel sets
  // the bypass cookie automatically after the first "proceed" click.
  app.use(express.static(_distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Bypass-Tunnel-Reminder', '1');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Bypass-Tunnel-Reminder', '1');
    res.sendFile(join(_distPath, 'index.html'));
  });
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
}

// ── Startup ───────────────────────────────────────────────────────────────────
(async () => {
  // 1. Database migrations (no-op if POSTGRES_URL not set)
  await runMigrations();

  // 2. Memory subsystem (selects adapter based on env vars)
  await initMemory();

  // 3. Redis event bridge (distributes events across instances)
  await initRedisEventBus();

  // 4. Wire structured logger to event bus
  structuredLogger.wireEventBus();

  // 5. Warm up health monitor sliding windows
  healthMonitor.getReport();

  _server = app.listen(PORT, () => {
    const hasOpenAI    = Boolean(process.env.OPENAI_API_KEY?.trim());
    const hasStability = Boolean(process.env.STABILITY_API_KEY?.trim());
    const hasPostgres  = Boolean(process.env.POSTGRES_URL);
    const hasRedis     = Boolean(process.env.REDIS_URL);
    const provider     = hasOpenAI ? 'OpenAI' : hasStability ? 'Stability AI' : 'Pollinations (free)';

    logger.info('server', `══════════════════════════════════════════════════`);
    logger.info('server', `  Nexus AI Agent OS  —  port :${PORT}`);
    logger.info('server', `══════════════════════════════════════════════════`);
    logger.info('server', `  Image provider     : ${provider}`);
    logger.info('server', `  PostgreSQL          : ${hasPostgres ? 'connected' : 'in-memory fallback'}`);
    logger.info('server', `  Redis               : ${hasRedis   ? 'connected' : 'in-process fallback'}`);
    logger.info('server', `──────────────────────────────────────────────────`);
    logger.info('server', `  Auth               : POST /auth/register  /auth/login`);
    logger.info('server', `  Agent (ReAct)      : POST /agent/run  /agent/react  /agent/multi`);
    logger.info('server', `  Agent (SSE stream) : POST /stream/react  /stream/multi  /stream/orchestrate`);
    logger.info('server', `  Full Orchestrator  : POST /agent/orchestrate`);
    logger.info('server', `  Tasks              : POST /tasks  GET /tasks/:id`);
    logger.info('server', `  Workflow engine    : POST /workflow  GET /workflow/:id`);
    logger.info('server', `  Memory             : GET/POST /memory  GET /memory/:ns/:key`);
    logger.info('server', `  Governance         : GET /governance/policies  /permissions`);
    logger.info('server', `  Observability      : GET /observability/dashboard  /metrics  /logs`);
    logger.info('server', `  Prometheus metrics : GET /metrics  /metrics/json`);
    logger.info('server', `  Health             : GET /health  /health/live  /health/dashboard`);
    logger.info('server', `  Recovery           : POST /recovery/recover/:taskId`);
    logger.info('server', `  Billing            : GET /billing/account  /billing/plans`);
    logger.info('server', `  Worker queue       : GET /queue/jobs  /queue/workers  /queue/dlq`);
    logger.info('server', `  Usage              : GET /usage`);
    logger.info('server', `──────────────────────────────────────────────────`);
    logger.info('server', `  Tools registered   : image-generation, text-generation, research, web-fetch, memory-read/write/delete`);
    logger.info('server', `══════════════════════════════════════════════════`);
  });
})();
