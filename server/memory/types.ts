export interface MemoryRecord {
  id: string;
  namespace: string;
  key: string;
  value: unknown;
  tags?: string[];
  userId?: string;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  ttl?: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface MemoryQuery {
  namespace?: string;
  key?: string;
  tags?: string[];
  userId?: string;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
}

export interface MemoryAdapter {
  get(namespace: string, key: string): Promise<MemoryRecord | null>;
  set(record: Omit<MemoryRecord, 'createdAt' | 'updatedAt'>): Promise<MemoryRecord>;
  delete(namespace: string, key: string): Promise<boolean>;
  query(q: MemoryQuery): Promise<MemoryRecord[]>;
  clear(namespace: string): Promise<number>;
  stats(): Promise<{ total: number; namespaces: Record<string, number> }>;
}
