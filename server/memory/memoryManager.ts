import { randomUUID } from 'crypto';
import type { MemoryAdapter, MemoryRecord, MemoryQuery } from './types.js';
import { InMemoryAdapter } from './adapters/inMemoryAdapter.js';
import { globalEventBus } from '../events/eventBus.js';

let adapter: MemoryAdapter = new InMemoryAdapter();

export async function initMemory(): Promise<void> {
  if (process.env.POSTGRES_URL) {
    const { PostgresAdapter } = await import('./adapters/postgresAdapter.js');
    const pg = new PostgresAdapter();
    await pg.connect(process.env.POSTGRES_URL);
    adapter = pg;
    console.log('[Memory] Using PostgreSQL adapter');
  } else if (process.env.REDIS_URL) {
    const { RedisAdapter } = await import('./adapters/redisAdapter.js');
    const redis = new RedisAdapter();
    await redis.connect(process.env.REDIS_URL);
    adapter = redis;
    console.log('[Memory] Using Redis adapter');
  } else {
    console.log('[Memory] Using in-memory adapter (no persistence)');
  }
}

export function getAdapter(): MemoryAdapter { return adapter; }

const emit = globalEventBus.createEmitter('memory');

export async function remember(
  namespace: string,
  key: string,
  value: unknown,
  opts?: Partial<Pick<MemoryRecord, 'tags' | 'userId' | 'taskId' | 'agentId' | 'sessionId' | 'ttl'>>
): Promise<MemoryRecord> {
  const record = await adapter.set({ id: randomUUID(), namespace, key, value, ...opts });
  emit('MEMORY_WRITTEN', { namespace, key, id: record.id });
  return record;
}

export async function recall(namespace: string, key: string): Promise<unknown | null> {
  const record = await adapter.get(namespace, key);
  emit('MEMORY_READ', { namespace, key, found: !!record });
  return record?.value ?? null;
}

export async function forget(namespace: string, key: string): Promise<boolean> {
  const deleted = await adapter.delete(namespace, key);
  emit('MEMORY_DELETED', { namespace, key, deleted });
  return deleted;
}

export async function rememberTask(taskId: string, data: unknown): Promise<void> {
  await remember('tasks', taskId, data, { taskId, tags: ['task'] });
}

export async function saveConversationTurn(
  sessionId: string,
  turn: { role: 'user' | 'assistant'; content: string; timestamp: number }
): Promise<void> {
  const existing = (await recall('conversations', sessionId) as unknown[]) ?? [];
  const turns = [...(Array.isArray(existing) ? existing : []), turn].slice(-100);
  await remember('conversations', sessionId, turns, { sessionId, tags: ['conversation'] });
}

export async function getConversationHistory(
  sessionId: string
): Promise<Array<{ role: string; content: string; timestamp: number }>> {
  const history = await recall('conversations', sessionId);
  return Array.isArray(history) ? history : [];
}

export async function saveAgentState(agentId: string, state: unknown): Promise<void> {
  await remember('agents', agentId, state, { agentId, tags: ['agent-state'] });
}

export async function getAgentState(agentId: string): Promise<unknown | null> {
  return recall('agents', agentId);
}

export const memory = {
  adapter: () => adapter,
  remember, recall, forget,
  rememberTask, saveConversationTurn, getConversationHistory, saveAgentState, getAgentState,
  query: (q: MemoryQuery) => adapter.query(q),
  clear: (ns: string)     => adapter.clear(ns),
  stats: ()               => adapter.stats(),
};
