import type { EventType, AgentEvent } from './eventTypes.js';
import { createEvent } from './eventTypes.js';

type Handler<P = unknown> = (event: AgentEvent<P>) => void | Promise<void>;

const MAX_HISTORY = 10_000;

export class EventBus {
  private subs = new Map<EventType, Set<Handler>>();
  private wildcardSubs = new Set<Handler>();
  private history: AgentEvent[] = [];

  emit<P>(event: AgentEvent<P>): void {
    this.history.push(event as AgentEvent);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    const handlers = this.subs.get(event.type);
    if (handlers) {
      for (const h of handlers) void h(event as AgentEvent);
    }
    for (const h of this.wildcardSubs) void h(event as AgentEvent);
  }

  on<P>(type: EventType, handler: Handler<P>): () => void {
    if (!this.subs.has(type)) this.subs.set(type, new Set());
    this.subs.get(type)!.add(handler as Handler);
    return () => this.subs.get(type)?.delete(handler as Handler);
  }

  onAny(handler: Handler): () => void {
    this.wildcardSubs.add(handler);
    return () => this.wildcardSubs.delete(handler);
  }

  createEmitter(source: string, correlationId?: string) {
    return <P>(
      type: EventType,
      payload: P,
      extra?: Partial<Pick<AgentEvent, 'userId' | 'taskId' | 'agentId'>>
    ) => {
      this.emit(createEvent(type, source, payload, { correlationId, ...extra }));
    };
  }

  getHistory(filter?: {
    type?: EventType;
    userId?: string;
    taskId?: string;
    since?: number;
  }): AgentEvent[] {
    let result = this.history;
    if (filter?.type)   result = result.filter(e => e.type === filter.type);
    if (filter?.userId) result = result.filter(e => e.userId === filter.userId);
    if (filter?.taskId) result = result.filter(e => e.taskId === filter.taskId);
    if (filter?.since)  result = result.filter(e => e.timestamp >= filter.since!);
    return result;
  }

  stats() {
    const counts: Partial<Record<EventType, number>> = {};
    for (const e of this.history) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return {
      total: this.history.length,
      counts,
      subscribers: this.subs.size + this.wildcardSubs.size,
    };
  }
}

export const globalEventBus = new EventBus();
