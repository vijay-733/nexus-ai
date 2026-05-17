import { randomUUID } from 'crypto';
import type { ExecutionCheckpoint } from './checkpoint.js';

export interface CheckpointStore {
  save(data: Omit<ExecutionCheckpoint, 'id' | 'createdAt'>): Promise<ExecutionCheckpoint>;
  get(id: string): Promise<ExecutionCheckpoint | null>;
  getByTaskId(taskId: string): Promise<ExecutionCheckpoint[]>;
  getLatestByTaskId(taskId: string): Promise<ExecutionCheckpoint | null>;
  delete(id: string): Promise<boolean>;
  list(filter?: { taskId?: string; agentId?: string }): Promise<ExecutionCheckpoint[]>;
  prune(): Promise<number>;
}

class InMemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, ExecutionCheckpoint>();

  async save(data: Omit<ExecutionCheckpoint, 'id' | 'createdAt'>): Promise<ExecutionCheckpoint> {
    const checkpoint: ExecutionCheckpoint = {
      ...data,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    this.store.set(checkpoint.id, checkpoint);
    return checkpoint;
  }

  async get(id: string): Promise<ExecutionCheckpoint | null> {
    return this.store.get(id) ?? null;
  }

  async getByTaskId(taskId: string): Promise<ExecutionCheckpoint[]> {
    return [...this.store.values()]
      .filter(c => c.taskId === taskId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getLatestByTaskId(taskId: string): Promise<ExecutionCheckpoint | null> {
    const all = await this.getByTaskId(taskId);
    return all[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async list(filter?: { taskId?: string; agentId?: string }): Promise<ExecutionCheckpoint[]> {
    let all = [...this.store.values()];
    if (filter?.taskId)  all = all.filter(c => c.taskId  === filter.taskId);
    if (filter?.agentId) all = all.filter(c => c.agentId === filter.agentId);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async prune(): Promise<number> {
    const now  = Date.now();
    let count  = 0;
    for (const [id, cp] of this.store) {
      if (cp.expiresAt && cp.expiresAt < now) {
        this.store.delete(id);
        count++;
      }
    }
    return count;
  }
}

export const checkpointStore: CheckpointStore = new InMemoryCheckpointStore();
