import { randomUUID }       from 'crypto';
import { globalEventBus }   from '../events/eventBus.js';
import {
  remember, recall, forget, getAdapter,
}                           from '../memory/memoryManager.js';
import { modelRouter }      from '../router/modelRouter.js';
import { logger }           from '../utils/logger.js';

const emit = globalEventBus.createEmitter('memory-agent');

export interface MemoryItem {
  namespace: string;
  key:       string;
  value:     unknown;
  tags:      string[];
  updatedAt: number;
}

export interface MemorySearchResult {
  items:     MemoryItem[];
  query:     string;
  total:     number;
  truncated: boolean;
}

export class MemoryAgent {
  async store(
    namespace: string,
    key: string,
    value: unknown,
    opts?: { userId?: string; taskId?: string; tags?: string[]; ttlMs?: number }
  ): Promise<void> {
    const record = await remember(namespace, key, value, {
      userId: opts?.userId,
      taskId: opts?.taskId,
      tags:   opts?.tags ?? [],
      ttl:    opts?.ttlMs ? Date.now() + opts.ttlMs : undefined,
    });
    logger.debug('memory-agent', `Stored ns=${namespace} key=${key} id=${record.id}`);
  }

  async retrieve(namespace: string, key: string): Promise<unknown | null> {
    const value = await recall(namespace, key);
    emit('MEMORY_READ', { namespace, key, found: value !== null });
    return value;
  }

  async search(
    namespace: string,
    query: string,
    opts?: { tags?: string[]; limit?: number; userId?: string; sessionId?: string }
  ): Promise<MemorySearchResult> {
    const adapter = getAdapter();
    const limit   = opts?.limit ?? 20;

    const records = await adapter.query({
      namespace,
      tags:      opts?.tags,
      userId:    opts?.userId,
      sessionId: opts?.sessionId,
      limit:     limit + 1,
    });

    const truncated = records.length > limit;
    const items: MemoryItem[] = records.slice(0, limit).map(r => ({
      namespace: r.namespace,
      key:       r.key,
      value:     r.value,
      tags:      r.tags ?? [],
      updatedAt: r.updatedAt,
    }));

    return { items, query, total: items.length, truncated };
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    const ok = await forget(namespace, key);
    if (ok) emit('MEMORY_DELETED', { namespace, key });
    return ok;
  }

  async compressNamespace(namespace: string, userId?: string): Promise<{ originalCount: number; summaryKey: string }> {
    const adapter = getAdapter();
    const records = await adapter.query({ namespace, userId, limit: 100 });

    if (records.length < 10) {
      return { originalCount: records.length, summaryKey: '' };
    }

    logger.info('memory-agent', `Compressing ${records.length} records in ns=${namespace}`);

    const textToCompress = records
      .slice(0, 50)
      .map(r => `[${r.key}]: ${typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)}`)
      .join('\n')
      .slice(0, 4_000);

    let summary: string;
    try {
      const response = await modelRouter.complete({
        messages: [
          { role: 'system', content: 'Summarise these memory entries concisely, preserving all important facts. Under 300 words.' },
          { role: 'user',   content: textToCompress },
        ],
        maxTokens: 400,
      });
      summary = response.content;
    } catch {
      summary = `Compressed ${records.length} memory entries from namespace "${namespace}"`;
    }

    const summaryKey = `summary-${randomUUID()}`;
    await remember(namespace, summaryKey, summary, { userId, tags: ['compressed-summary', 'auto-generated'] });

    for (const rec of records.slice(0, 50)) {
      await forget(rec.namespace, rec.key);
    }

    logger.info('memory-agent', `Compressed → summary key=${summaryKey}`);
    emit('MEMORY_WRITTEN', { namespace, key: summaryKey, compressed: true });
    return { originalCount: records.length, summaryKey };
  }

  async buildContext(sessionId: string, maxEntries = 10): Promise<string> {
    const adapter = getAdapter();
    const records = await adapter.query({ sessionId, limit: maxEntries });

    if (!records.length) return '';

    return records
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(r => `[${r.key}]: ${typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)}`)
      .join('\n');
  }
}

export const memoryAgent = new MemoryAgent();
