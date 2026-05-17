// Requires: npm install pg @types/pg
// Schema (auto-created on connect):
//   CREATE TABLE agent_memory (id TEXT PRIMARY KEY, namespace TEXT, key TEXT,
//     value JSONB, tags TEXT[], user_id TEXT, task_id TEXT, agent_id TEXT,
//     session_id TEXT, ttl BIGINT, expires_at BIGINT, created_at BIGINT, updated_at BIGINT,
//     UNIQUE(namespace, key));
import type { MemoryAdapter, MemoryRecord, MemoryQuery } from '../types.js';
import { InMemoryAdapter } from './inMemoryAdapter.js';

export class PostgresAdapter implements MemoryAdapter {
  private client: import('pg').Client | null = null;
  private fallback = new InMemoryAdapter();
  private ready    = false;

  async connect(connectionString: string): Promise<void> {
    try {
      const { Client } = await import('pg');
      this.client = new Client({ connectionString });
      await this.client.connect();
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS agent_memory (
          id TEXT PRIMARY KEY, namespace TEXT NOT NULL, key TEXT NOT NULL,
          value JSONB NOT NULL, tags TEXT[], user_id TEXT, task_id TEXT,
          agent_id TEXT, session_id TEXT, ttl BIGINT, expires_at BIGINT,
          created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
          UNIQUE(namespace, key)
        );
        CREATE INDEX IF NOT EXISTS idx_am_namespace  ON agent_memory(namespace);
        CREATE INDEX IF NOT EXISTS idx_am_user_id    ON agent_memory(user_id);
        CREATE INDEX IF NOT EXISTS idx_am_session_id ON agent_memory(session_id);
      `);
      this.ready = true;
    } catch (err) {
      console.error('[PostgresAdapter] Connection failed, falling back to in-memory:', err);
      this.ready = false;
    }
  }

  async get(namespace: string, key: string): Promise<MemoryRecord | null> {
    if (!this.ready) return this.fallback.get(namespace, key);
    const { rows } = await this.client!.query(
      'SELECT * FROM agent_memory WHERE namespace=$1 AND key=$2 AND (expires_at IS NULL OR expires_at > $3)',
      [namespace, key, Date.now()]
    );
    return rows.length ? this.toRecord(rows[0]) : null;
  }

  async set(record: Omit<MemoryRecord, 'createdAt' | 'updatedAt'>): Promise<MemoryRecord> {
    if (!this.ready) return this.fallback.set(record);
    const now = Date.now();
    const expiresAt = record.ttl ? now + record.ttl : null;
    const { rows } = await this.client!.query(
      `INSERT INTO agent_memory
         (id, namespace, key, value, tags, user_id, task_id, agent_id, session_id, ttl, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       ON CONFLICT (namespace, key) DO UPDATE SET
         value=$4, tags=$5, user_id=$6, task_id=$7, agent_id=$8,
         session_id=$9, ttl=$10, expires_at=$11, updated_at=$12
       RETURNING *`,
      [record.id, record.namespace, record.key, JSON.stringify(record.value),
       record.tags ?? null, record.userId ?? null, record.taskId ?? null,
       record.agentId ?? null, record.sessionId ?? null, record.ttl ?? null, expiresAt, now]
    );
    return this.toRecord(rows[0]);
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    if (!this.ready) return this.fallback.delete(namespace, key);
    const { rowCount } = await this.client!.query(
      'DELETE FROM agent_memory WHERE namespace=$1 AND key=$2', [namespace, key]
    );
    return (rowCount ?? 0) > 0;
  }

  async query(q: MemoryQuery): Promise<MemoryRecord[]> {
    if (!this.ready) return this.fallback.query(q);
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (!q.includeExpired) { conditions.push(`(expires_at IS NULL OR expires_at > $${idx++})`); params.push(Date.now()); }
    if (q.namespace) { conditions.push(`namespace=$${idx++}`); params.push(q.namespace); }
    if (q.key)       { conditions.push(`key=$${idx++}`);       params.push(q.key); }
    if (q.userId)    { conditions.push(`user_id=$${idx++}`);    params.push(q.userId); }
    if (q.taskId)    { conditions.push(`task_id=$${idx++}`);    params.push(q.taskId); }
    if (q.agentId)   { conditions.push(`agent_id=$${idx++}`);   params.push(q.agentId); }
    if (q.sessionId) { conditions.push(`session_id=$${idx++}`); params.push(q.sessionId); }
    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = q.limit  ?? 100;
    const offset = q.offset ?? 0;
    const { rows } = await this.client!.query(
      `SELECT * FROM agent_memory ${where} ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );
    return rows.map(r => this.toRecord(r));
  }

  async clear(namespace: string): Promise<number> {
    if (!this.ready) return this.fallback.clear(namespace);
    const { rowCount } = await this.client!.query(
      'DELETE FROM agent_memory WHERE namespace=$1', [namespace]
    );
    return rowCount ?? 0;
  }

  async stats(): Promise<{ total: number; namespaces: Record<string, number> }> {
    if (!this.ready) return this.fallback.stats();
    const { rows } = await this.client!.query(
      'SELECT namespace, COUNT(*) as cnt FROM agent_memory GROUP BY namespace'
    );
    const namespaces: Record<string, number> = {};
    let total = 0;
    for (const r of rows) { namespaces[r.namespace] = Number(r.cnt); total += Number(r.cnt); }
    return { total, namespaces };
  }

  private toRecord(row: Record<string, unknown>): MemoryRecord {
    return {
      id:        row.id as string,
      namespace: row.namespace as string,
      key:       row.key as string,
      value:     row.value,
      tags:      row.tags as string[] | undefined,
      userId:    row.user_id as string | undefined,
      taskId:    row.task_id as string | undefined,
      agentId:   row.agent_id as string | undefined,
      sessionId: row.session_id as string | undefined,
      ttl:       row.ttl as number | undefined,
      expiresAt: row.expires_at as number | undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }
}
