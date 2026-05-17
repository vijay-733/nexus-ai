import { randomUUID } from 'crypto';

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'active' | 'ok' | 'error';
  error?: string;
  tags: Record<string, unknown>;
  logs: Array<{ time: number; message: string }>;
}

const MAX_TRACES   = 5_000;
const TRACE_TTL_MS = 10 * 60_000;

export class Tracer {
  private spans      = new Map<string, Span>();
  private traceIndex = new Map<string, string[]>(); // traceId → spanIds[]
  private gcTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.gcTimer = setInterval(() => this.gc(), 60_000);
    this.gcTimer.unref?.();
  }

  start(
    name: string,
    opts?: { traceId?: string; parentSpanId?: string; tags?: Record<string, unknown> }
  ): Span {
    const span: Span = {
      traceId:      opts?.traceId ?? randomUUID(),
      spanId:       randomUUID(),
      parentSpanId: opts?.parentSpanId,
      name,
      startTime:    Date.now(),
      status:       'active',
      tags:         opts?.tags ?? {},
      logs:         [],
    };
    this.spans.set(span.spanId, span);
    if (!this.traceIndex.has(span.traceId)) this.traceIndex.set(span.traceId, []);
    this.traceIndex.get(span.traceId)!.push(span.spanId);
    return span;
  }

  end(spanId: string, status: 'ok' | 'error' = 'ok', error?: string): Span | null {
    const span = this.spans.get(spanId);
    if (!span) return null;
    span.endTime  = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status   = status;
    if (error) span.error = error;
    return span;
  }

  log(spanId: string, message: string): void {
    this.spans.get(spanId)?.logs.push({ time: Date.now(), message });
  }

  tag(spanId: string, key: string, value: unknown): void {
    const span = this.spans.get(spanId);
    if (span) span.tags[key] = value;
  }

  childSpan(parentSpan: Span, name: string, tags?: Record<string, unknown>): Span {
    return this.start(name, { traceId: parentSpan.traceId, parentSpanId: parentSpan.spanId, tags });
  }

  getTrace(traceId: string): Span[] {
    const ids = this.traceIndex.get(traceId) ?? [];
    return ids.map(id => this.spans.get(id)).filter(Boolean) as Span[];
  }

  getSpan(spanId: string): Span | null {
    return this.spans.get(spanId) ?? null;
  }

  listTraces(limit = 100): Array<{
    traceId: string; rootSpan: string; spanCount: number; startTime: number;
  }> {
    const result: Array<{ traceId: string; rootSpan: string; spanCount: number; startTime: number }> = [];
    for (const [traceId, spanIds] of this.traceIndex) {
      const root = this.spans.get(spanIds[0]);
      if (root) result.push({ traceId, rootSpan: root.name, spanCount: spanIds.length, startTime: root.startTime });
    }
    return result.sort((a, b) => b.startTime - a.startTime).slice(0, limit);
  }

  private gc(): void {
    const cutoff = Date.now() - TRACE_TTL_MS;
    for (const [traceId, spanIds] of this.traceIndex) {
      const root = this.spans.get(spanIds[0]);
      if (!root || root.startTime < cutoff) {
        for (const id of spanIds) this.spans.delete(id);
        this.traceIndex.delete(traceId);
      }
    }
    if (this.traceIndex.size > MAX_TRACES) {
      const sorted = [...this.traceIndex.entries()]
        .map(([id, spans]) => ({ id, t: this.spans.get(spans[0])?.startTime ?? 0 }))
        .sort((a, b) => a.t - b.t);
      for (const { id } of sorted.slice(0, sorted.length - MAX_TRACES)) {
        const ids = this.traceIndex.get(id) ?? [];
        for (const sid of ids) this.spans.delete(sid);
        this.traceIndex.delete(id);
      }
    }
  }
}

export const tracer = new Tracer();
