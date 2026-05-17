import { Router } from 'express';
import { metricsCollector } from '../observability/metrics.js';
import { tracer } from '../observability/tracer.js';
import { structuredLogger } from '../observability/structuredLogger.js';
import { globalEventBus } from '../events/eventBus.js';
import { agentRuntime } from '../runtime/agentRuntime.js';
import { modelRouter } from '../router/modelRouter.js';

export const observabilityRouter = Router();

observabilityRouter.get('/dashboard', (_req, res) => {
  res.json({
    metrics:   metricsCollector.getReport(),
    runtime:   agentRuntime.stats(),
    eventBus:  globalEventBus.stats(),
    providers: modelRouter.getProviderStatus(),
  });
});

observabilityRouter.get('/metrics', (_req, res) => {
  res.json(metricsCollector.getReport());
});

observabilityRouter.get('/traces', (req, res) => {
  const limit = Number((req.query as Record<string, string>).limit) || 100;
  res.json(tracer.listTraces(limit));
});

observabilityRouter.get('/traces/:traceId', (req, res) => {
  const spans = tracer.getTrace(req.params.traceId);
  if (!spans.length) { res.status(404).json({ error: 'Trace not found' }); return; }
  res.json(spans);
});

observabilityRouter.get('/logs', (req, res) => {
  const q = req.query as Record<string, string>;
  res.json(structuredLogger.query({
    level:   q.level as 'debug' | 'info' | 'warn' | 'error' | undefined,
    source:  q.source,
    userId:  q.userId,
    taskId:  q.taskId,
    agentId: q.agentId,
    since:   q.since  ? Number(q.since)  : undefined,
    until:   q.until  ? Number(q.until)  : undefined,
    search:  q.search,
    limit:   q.limit  ? Number(q.limit)  : 200,
    offset:  q.offset ? Number(q.offset) : 0,
  }));
});

observabilityRouter.get('/logs/export', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="logs.json"');
  res.send(structuredLogger.exportJSON());
});

observabilityRouter.get('/events', (req, res) => {
  const q = req.query as Record<string, string>;
  res.json(globalEventBus.getHistory({
    userId: q.userId,
    taskId: q.taskId,
    since:  q.since ? Number(q.since) : undefined,
  }));
});

observabilityRouter.get('/runtime', (_req, res) => {
  res.json(agentRuntime.stats());
});
