import { randomUUID } from 'crypto';
import type { MemoryAdapter, MemoryRecord, MemoryQuery } from '../types.js';

export class InMemoryAdapter implements MemoryAdapter {
  private store    = new Map<string, MemoryRecord>();
  private keyIndex = new Map<string, string>(); // "ns:key" → id

  private compoundKey(ns: string, k: string): string { return `${ns}:${k}`; }

  async get(namespace: string, key: string): Promise<MemoryRecord | null> {
    const id = this.keyIndex.get(this.compoundKey(namespace, key));
    if (!id) return null;
    const rec = this.store.get(id);
    if (!rec) return null;
    if (rec.expiresAt && rec.expiresAt < Date.now()) {
      this.store.delete(id);
      this.keyIndex.delete(this.compoundKey(namespace, key));
      return null;
    }
    return rec;
  }

  async set(record: Omit<MemoryRecord, 'createdAt' | 'updatedAt'>): Promise<MemoryRecord> {
    const existing = await this.get(record.namespace, record.key);
    const now = Date.now();
    const full: MemoryRecord = {
      ...record,
      id:        existing?.id ?? record.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: record.ttl ? now + record.ttl : undefined,
    };
    this.store.set(full.id, full);
    this.keyIndex.set(this.compoundKey(full.namespace, full.key), full.id);
    return full;
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    const id = this.keyIndex.get(this.compoundKey(namespace, key));
    if (!id) return false;
    this.keyIndex.delete(this.compoundKey(namespace, key));
    return this.store.delete(id);
  }

  async query(q: MemoryQuery): Promise<MemoryRecord[]> {
    const now = Date.now();
    let results = [...this.store.values()].filter(r => {
      if (!q.includeExpired && r.expiresAt && r.expiresAt < now) return false;
      if (q.namespace && r.namespace !== q.namespace) return false;
      if (q.key       && r.key       !== q.key)       return false;
      if (q.userId    && r.userId    !== q.userId)     return false;
      if (q.taskId    && r.taskId    !== q.taskId)     return false;
      if (q.agentId   && r.agentId   !== q.agentId)   return false;
      if (q.sessionId && r.sessionId !== q.sessionId) return false;
      if (q.tags?.length && !r.tags?.some(t => q.tags!.includes(t))) return false;
      return true;
    });
    results.sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = q.offset ?? 0;
    const limit  = q.limit  ?? 100;
    return results.slice(offset, offset + limit);
  }

  async clear(namespace: string): Promise<number> {
    let count = 0;
    for (const [id, rec] of this.store) {
      if (rec.namespace === namespace) {
        this.keyIndex.delete(this.compoundKey(namespace, rec.key));
        this.store.delete(id);
        count++;
      }
    }
    return count;
  }

  async stats(): Promise<{ total: number; namespaces: Record<string, number> }> {
    const namespaces: Record<string, number> = {};
    for (const rec of this.store.values()) {
      namespaces[rec.namespace] = (namespaces[rec.namespace] ?? 0) + 1;
    }
    return { total: this.store.size, namespaces };
  }
}
