import { globalEventBus } from '../events/eventBus.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  level: LogLevel;
  source: string;
  message: string;
  timestamp: number;
  userId?: string;
  taskId?: string;
  agentId?: string;
  traceId?: string;
  data?: unknown;
}

export interface LogFilter {
  level?: LogLevel;
  source?: string;
  userId?: string;
  taskId?: string;
  agentId?: string;
  since?: number;
  until?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_ENTRIES = 100_000;

export class StructuredLogger {
  private entries: LogEntry[] = [];
  private counter = 0;

  private write(
    level: LogLevel,
    source: string,
    message: string,
    meta?: Partial<Pick<LogEntry, 'userId' | 'taskId' | 'agentId' | 'traceId' | 'data'>>
  ): void {
    const entry: LogEntry = {
      id: ++this.counter,
      level, source, message,
      timestamp: Date.now(),
      ...meta,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  debug(source: string, message: string, meta?: Partial<Pick<LogEntry, 'userId' | 'taskId' | 'agentId' | 'traceId' | 'data'>>): void {
    this.write('debug', source, message, meta);
  }

  info(source: string, message: string, meta?: Partial<Pick<LogEntry, 'userId' | 'taskId' | 'agentId' | 'traceId' | 'data'>>): void {
    this.write('info', source, message, meta);
  }

  warn(source: string, message: string, meta?: Partial<Pick<LogEntry, 'userId' | 'taskId' | 'agentId' | 'traceId' | 'data'>>): void {
    this.write('warn', source, message, meta);
  }

  error(source: string, message: string, meta?: Partial<Pick<LogEntry, 'userId' | 'taskId' | 'agentId' | 'traceId' | 'data'>>): void {
    this.write('error', source, message, meta);
  }

  query(filter: LogFilter = {}): LogEntry[] {
    const minLevel = LEVEL_ORDER[filter.level ?? 'debug'];
    let results = this.entries.filter(e => {
      if (LEVEL_ORDER[e.level] < minLevel)                                               return false;
      if (filter.source  && e.source  !== filter.source)                                 return false;
      if (filter.userId  && e.userId  !== filter.userId)                                 return false;
      if (filter.taskId  && e.taskId  !== filter.taskId)                                 return false;
      if (filter.agentId && e.agentId !== filter.agentId)                               return false;
      if (filter.since   && e.timestamp < filter.since)                                  return false;
      if (filter.until   && e.timestamp > filter.until)                                  return false;
      if (filter.search  && !e.message.toLowerCase().includes(filter.search.toLowerCase())) return false;
      return true;
    });
    results = results.slice().reverse();
    const offset = filter.offset ?? 0;
    const limit  = filter.limit  ?? 200;
    return results.slice(offset, offset + limit);
  }

  exportJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  wireEventBus(): void {
    globalEventBus.onAny(event => {
      this.info('event-bus', event.type, {
        userId:  event.userId,
        taskId:  event.taskId,
        agentId: event.agentId,
        data:    event.payload,
      });
    });
  }
}

export const structuredLogger = new StructuredLogger();
