import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';
import type { AgentMessage, AgentRole } from './agentMessage.js';

type AgentHandler<P = unknown> = (msg: AgentMessage<P>) => Promise<unknown>;

const emit = globalEventBus.createEmitter('message-router');

export class MessageRouter {
  private handlers = new Map<AgentRole, AgentHandler>();
  private pending  = new Map<string, {
    resolve: (v: unknown) => void;
    reject:  (e: Error) => void;
    timer:   ReturnType<typeof setTimeout>;
  }>();

  register(role: AgentRole, handler: AgentHandler): void {
    this.handlers.set(role, handler);
  }

  unregister(role: AgentRole): void {
    this.handlers.delete(role);
  }

  async send<P, R = unknown>(
    msg: Omit<AgentMessage<P>, 'id' | 'timestamp'>
  ): Promise<R> {
    const full: AgentMessage<P> = { ...msg, id: randomUUID(), timestamp: Date.now() };

    emit('TOOL_CALLED', { from: full.from, to: full.to, type: full.type }, {
      taskId: full.taskId, userId: full.userId,
    });

    if (full.to === 'broadcast') {
      for (const [, h] of this.handlers) void h(full as AgentMessage);
      return undefined as R;
    }

    const handler = this.handlers.get(full.to as AgentRole);
    if (!handler) throw new Error(`No handler for agent role "${full.to}"`);

    const timeoutMs = full.constraints?.timeoutMs ?? 60_000;

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(full.id);
        reject(new Error(`AgentMessage to "${full.to}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(full.id, {
        resolve: v => { clearTimeout(timer); resolve(v as R); },
        reject:  e => { clearTimeout(timer); reject(e); },
        timer,
      });

      handler(full as AgentMessage)
        .then(result => {
          this.pending.get(full.id)?.resolve(result);
          this.pending.delete(full.id);
        })
        .catch(err => {
          this.pending.get(full.id)?.reject(err instanceof Error ? err : new Error(String(err)));
          this.pending.delete(full.id);
        });
    });
  }

  getRegistered(): AgentRole[] { return [...this.handlers.keys()]; }
}

export const messageRouter = new MessageRouter();
