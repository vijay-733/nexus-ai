import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  requestedBy?: string;
  agentId?: string;
  taskId?: string;
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

const APPROVAL_TTL_MS = 15 * 60_000;
const emit = globalEventBus.createEmitter('approval-workflow');

export class ApprovalWorkflow {
  private requests  = new Map<string, ApprovalRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private gcTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.gcTimer = setInterval(() => this.gc(), 60_000);
    this.gcTimer.unref?.();
  }

  request(
    action: string,
    description: string,
    meta?: { requestedBy?: string; agentId?: string; taskId?: string }
  ): { id: string; promise: Promise<boolean> } {
    const id  = randomUUID();
    const now = Date.now();
    const req: ApprovalRequest = {
      id, action, description,
      requestedBy: meta?.requestedBy,
      agentId:     meta?.agentId,
      taskId:      meta?.taskId,
      status:      'pending',
      createdAt:   now,
      expiresAt:   now + APPROVAL_TTL_MS,
    };
    this.requests.set(id, req);

    const promise = new Promise<boolean>(resolve => {
      this.resolvers.set(id, resolve);
      setTimeout(() => {
        if (this.requests.get(id)?.status === 'pending') {
          this.expire(id);
          resolve(false);
        }
      }, APPROVAL_TTL_MS);
    });

    emit('APPROVAL_REQUESTED', { id, action, description }, {
      userId: meta?.requestedBy, agentId: meta?.agentId, taskId: meta?.taskId,
    });
    return { id, promise };
  }

  approve(id: string, resolvedBy?: string): boolean {
    return this.resolve(id, true, resolvedBy);
  }

  deny(id: string, resolvedBy?: string): boolean {
    return this.resolve(id, false, resolvedBy);
  }

  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  list(status?: ApprovalStatus): ApprovalRequest[] {
    const all = [...this.requests.values()];
    return status ? all.filter(r => r.status === status) : all;
  }

  private resolve(id: string, approved: boolean, resolvedBy?: string): boolean {
    const req = this.requests.get(id);
    if (!req || req.status !== 'pending') return false;
    req.status     = approved ? 'approved' : 'denied';
    req.resolvedAt = Date.now();
    req.resolvedBy = resolvedBy;
    this.resolvers.get(id)?.(approved);
    this.resolvers.delete(id);
    emit(approved ? 'APPROVAL_GRANTED' : 'APPROVAL_DENIED', { id, action: req.action, resolvedBy });
    return true;
  }

  private expire(id: string): void {
    const req = this.requests.get(id);
    if (req?.status === 'pending') {
      req.status     = 'expired';
      req.resolvedAt = Date.now();
    }
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, req] of this.requests) {
      if (req.status !== 'pending' && now - (req.resolvedAt ?? req.createdAt) > 60 * 60_000) {
        this.requests.delete(id);
        this.resolvers.delete(id);
      }
    }
  }
}

export const approvalWorkflow = new ApprovalWorkflow();
