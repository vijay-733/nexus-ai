import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'timeout';

export interface AgentInstance {
  id: string;
  name: string;
  status: AgentStatus;
  startedAt: number;
  lastActivityAt: number;
  taskId?: string;
  userId?: string;
  stepCount: number;
  maxSteps: number;
  timeoutMs: number;
  metadata: Record<string, unknown>;
}

export type AgentFactory = (instance: AgentInstance) => Promise<unknown>;

const AGENT_TIMEOUT_MS = 5 * 60_000;
const GC_INTERVAL_MS   = 10_000;

export class AgentRuntime {
  private registry  = new Map<string, AgentFactory>();
  private instances = new Map<string, AgentInstance>();
  private gcTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
    this.gcTimer.unref?.();
  }

  register(name: string, factory: AgentFactory): void {
    this.registry.set(name, factory);
  }

  async spawn(
    name: string,
    opts?: {
      taskId?: string; userId?: string; maxSteps?: number;
      timeoutMs?: number; metadata?: Record<string, unknown>;
    }
  ): Promise<AgentInstance> {
    const factory = this.registry.get(name);
    if (!factory) throw new Error(`Agent "${name}" not registered`);

    const instance: AgentInstance = {
      id: randomUUID(),
      name,
      status: 'running',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      taskId: opts?.taskId,
      userId: opts?.userId,
      stepCount: 0,
      maxSteps:  opts?.maxSteps  ?? 50,
      timeoutMs: opts?.timeoutMs ?? AGENT_TIMEOUT_MS,
      metadata:  opts?.metadata  ?? {},
    };

    this.instances.set(instance.id, instance);
    const emit = globalEventBus.createEmitter('runtime', instance.id);
    emit('AGENT_STARTED', { agentId: instance.id, name }, {
      agentId: instance.id, taskId: instance.taskId, userId: instance.userId,
    });

    try {
      const result = await factory(instance);
      instance.status = 'completed';
      emit('AGENT_COMPLETED', { agentId: instance.id, result }, {
        agentId: instance.id, taskId: instance.taskId, userId: instance.userId,
      });
    } catch (err) {
      instance.status = 'failed';
      emit('AGENT_FAILED', { agentId: instance.id, error: String(err) }, {
        agentId: instance.id, taskId: instance.taskId,
      });
    }

    return instance;
  }

  get(id: string): AgentInstance | undefined {
    return this.instances.get(id);
  }

  list(filter?: { status?: AgentStatus; userId?: string }): AgentInstance[] {
    let result = [...this.instances.values()];
    if (filter?.status) result = result.filter(i => i.status === filter.status);
    if (filter?.userId) result = result.filter(i => i.userId === filter.userId);
    return result;
  }

  terminate(id: string): boolean {
    const inst = this.instances.get(id);
    if (!inst || inst.status === 'completed' || inst.status === 'failed') return false;
    inst.status = 'failed';
    globalEventBus.createEmitter('runtime')('AGENT_FAILED', { agentId: id, error: 'terminated' }, { agentId: id });
    return true;
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, inst] of this.instances) {
      if (inst.status === 'running' && now - inst.startedAt > inst.timeoutMs) {
        inst.status = 'timeout';
        globalEventBus.createEmitter('runtime')('AGENT_FAILED', { agentId: id, error: 'timeout' }, { agentId: id });
      }
      const terminal = inst.status === 'completed' || inst.status === 'failed' || inst.status === 'timeout';
      if (terminal && now - inst.startedAt > 60 * 60_000) {
        this.instances.delete(id);
      }
    }
  }

  stats() {
    const counts: Record<string, number> = {};
    for (const inst of this.instances.values()) {
      counts[inst.status] = (counts[inst.status] ?? 0) + 1;
    }
    return { total: this.instances.size, byStatus: counts, registered: [...this.registry.keys()] };
  }
}

export const agentRuntime = new AgentRuntime();
