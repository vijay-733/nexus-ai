import { Router } from 'express';
import { exportPrometheusMetrics } from '../observability/prometheusExporter.js';
import { metricsCollector }        from '../observability/metrics.js';

export const metricsRouter = Router();

// GET /metrics — Prometheus scrape endpoint (no auth — protected at network layer)
metricsRouter.get('/', (_req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(exportPrometheusMetrics());
});

// GET /metrics/json — JSON format for internal dashboards
metricsRouter.get('/json', (_req, res) => {
  res.json(metricsCollector.getReport());
});
