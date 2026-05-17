import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import type { MemoryAdapter, MemoryRecord, MemoryQuery } from '../types.js';
import { InMemoryAdapter } from './inMemoryAdapter.js';

export class RedisAdapter implements MemoryAdapter {
  private client:   Redis | null = null;
  private fallback  = new InMemoryAdapter();
  private ready     = false;

  async connect(url: string): Promise<void> {
    try {
      this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
      await this.client.connect();
      this.ready = true;
    } catch (err) {
      console.error('[RedisAdapter] Connection failed, falling back to in-memory:', err);
      this.ready = false;
    }
  }

  private recordKey(ns: string, key: string): string { return `mem:${ns}:${key}`; }
  private idxKey(ns: string): string                 { return `mem_idx:${ns}`; }

  async get(namespace: string, key: string): Promise<MemoryRecord | null> {
    if (!this.ready) return this.fallback.get(namespace, key);
    const raw = await this.client!.get(this.recordKey(namespace, key));
    return raw ? JSON.parse(raw) as MemoryRecord : null;
  }

  async set(record: Omit<MemoryRecord, 'createdAt' | 'updatedAt'>): Promise<MemoryRecord> {
    if (!this.ready) return this.fallback.set(record);
    const now      = Date.now();
    const existing = await this.get(record.namespace, record.key);
    const full: MemoryRecord = {
      ...record,
      id:        existing?.id ?? record.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: record.ttl ? now + record.ttl : undefined,
    };
    const k = this.recordKey(full.namespace, full.key);
    const json = JSON.stringify(full);
    if (full.ttl) {
      await this.client!.set(k, json, 'PX', full.ttl);
    } else {
      await this.client!.set(k, json);
    }
    await this.client!.sadd(this.idxKey(full.namespace), `${full.namespace}:${full.key}`);
    return full;
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    if (!this.ready) return this.fallback.delete(namespace, key);
    const count = await this.client!.del(this.recordKey(namespace, key));
    await this.client!.srem(this.idxKey(namespace), `${namespace}:${key}`);
    return count > 0;
  }

  async query(q: MemoryQuery): Promise<MemoryRecord[]> {
    if (!this.ready) return this.fallback.query(q);
    const namespaces = q.namespace ? [q.namespace] : await this.listNamespaces();
    const records: MemoryRecord[] = [];

    for (const ns of namespaces) {
      const members = await this.client!.smembers(this.idxKey(ns));
      for (const member of members) {
        const colonIdx = member.indexOf(':');
        const mns  = member.slice(0, colonIdx);
        const mkey = member.slice(colonIdx + 1);
        const rec  = await this.get(mns, mkey);
        if (!rec)                                                             continue;
        if (q.key       && rec.key       !== q.key)                          continue;
        if (q.userId    && rec.userId    !== q.userId)                       continue;
        if (q.taskId    && rec.taskId    !== q.taskId)                       continue;
        if (q.agentId   && rec.agentId   !== q.agentId)                     continue;
        if (q.sessionId && rec.sessionId !== q.sessionId)                   continue;
        if (q.tags?.length && !rec.tags?.some(t => q.tags!.includes(t)))    continue;
        records.push(rec);
      }
    }

    records.sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = q.offset ?? 0;
    const limit  = q.limit  ?? 100;
    return records.slice(offset, offset + limit);
  }

  async clear(namespace: string): Promise<number> {
    if (!this.ready) return this.fallback.clear(namespace);
    const members = await this.client!.smembers(this.idxKey(namespace));
    let count = 0;
    for (const member of members) {
      const colonIdx = member.indexOf(':');
      await this.client!.del(this.recordKey(member.slice(0, colonIdx), member.slice(colonIdx + 1)));
      count++;
    }
    await this.client!.del(this.idxKey(namespace));
    return count;
  }

  async stats(): Promise<{ total: number; namespaces: Record<string, number> }> {
    if (!this.ready) return this.fallback.stats();
    const namespaces: Record<string, number> = {};
    let total = 0;
    for (const ns of await this.listNamespaces()) {
      const cnt = await this.client!.scard(this.idxKey(ns));
      namespaces[ns] = cnt;
      total += cnt;
    }
    return { total, namespaces };
  }

  private async listNamespaces(): Promise<string[]> {
    const keys = await this.client!.keys('mem_idx:*');
    return keys.map(k => k.replace('mem_idx:', ''));
  }
}
