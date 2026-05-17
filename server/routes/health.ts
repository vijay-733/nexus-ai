import { Router } from 'express';
import { healthMonitor } from '../health/healthMonitor.js';
import { alertSystem } from '../health/alertSystem.js';
import { recoveryEngine } from '../recovery/recoveryEngine.js';
import { agentRuntime } from '../runtime/agentRuntime.js';
import { metricsCollector } from '../observability/metrics.js';
import { modelRouter } from '../router/modelRouter.js';

export const healthRouter = Router();

// Full health report with all check details
healthRouter.get('/', (_req, res) => {
  res.json(healthMonitor.getReport());
});

// Kubernetes-style liveness probe — 503 if critical
healthRouter.get('/live', (_req, res) => {
  const report = healthMonitor.getReport();
  const ok = report.status !== 'critical';
  res.status(ok ? 200 : 503).json({
    ok,
    status:    report.status,
    checkedAt: report.checkedAt,
  });
});

// Kubernetes-style readiness probe
healthRouter.get('/ready', (_req, res) => {
  res.json({ ready: true, uptime: process.uptime() });
});

// Aggregated system dashboard (health + metrics + runtime + providers)
healthRouter.get('/dashboard', (_req, res) => {
  res.json({
    health:    healthMonitor.getReport(),
    metrics:   metricsCollector.getReport(),
    runtime:   agentRuntime.stats(),
    providers: modelRouter.getProviderStatus(),
    recovery:  recoveryEngine.getStats(),
  });
});

// Runtime update of alert config
healthRouter.patch('/alerts', (req, res) => {
  alertSystem.configure(req.body as Parameters<typeof alertSystem.configure>[0]);
  res.json({ updated: true });
});
