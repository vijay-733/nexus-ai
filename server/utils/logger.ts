import { structuredLogger } from '../observability/structuredLogger.js';

type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function emit(level: Level, ctx: string, msg: string, data?: unknown): void {
  const ts  = new Date().toISOString();
  const line = `[${ts}] [${level.padEnd(5)}] [${ctx}] ${msg}`;
  if (data !== undefined) {
    (level === 'ERROR' ? console.error : console.log)(line, data);
  } else {
    (level === 'ERROR' ? console.error : console.log)(line);
  }
  // Mirror to structured logger so /observability/logs shows agent traces
  const sl = level.toLowerCase() as 'info' | 'warn' | 'error' | 'debug';
  structuredLogger[sl](ctx, msg, data !== undefined ? { data } : undefined);
}

export const logger = {
  info:  (ctx: string, msg: string, data?: unknown) => emit('INFO',  ctx, msg, data),
  warn:  (ctx: string, msg: string, data?: unknown) => emit('WARN',  ctx, msg, data),
  error: (ctx: string, msg: string, data?: unknown) => emit('ERROR', ctx, msg, data),
  debug: (ctx: string, msg: string, data?: unknown) => emit('DEBUG', ctx, msg, data),
};
