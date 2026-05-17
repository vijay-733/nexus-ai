import { randomUUID } from 'crypto';
import { globalEventBus } from '../events/eventBus.js';
import { WorkflowGraph } from './workflowGraph.js';
import type { Workflow, WorkflowNode } from './workflowTypes.js';

export type NodeExecutor = (node: WorkflowNode, workflow: Workflow) => Promise<unknown>;

const emit = globalEventBus.createEmitter('workflow-engine');

const RETRY_BACKOFF_MS = (n: number) => Math.min(1_000 * Math.pow(2, n - 1), 15_000);

export class WorkflowEngine {
  private workflows = new Map<string, Workflow>();
  private executors = new Map<string, NodeExecutor>();

  registerExecutor(nodeType: string, fn: NodeExecutor): void {
    this.executors.set(nodeType, fn);
  }

  create(
    name: string,
    nodes: Omit<WorkflowNode, 'status' | 'retries'>[],
    opts?: {
      userId?:      string;
      taskId?:      string;
      input?:       unknown;
      description?: string;
      metadata?:    Record<string, unknown>;
    }
  ): Workflow {
    const wf: Workflow = {
      id:          randomUUID(),
      name,
      description: opts?.description,
      status:      'pending',
      nodes:       nodes.map(n => ({
        ...n,
        status:     'pending',
        retries:    0,
        maxRetries: n.maxRetries ?? 3,
      })),
      userId:   opts?.userId,
      taskId:   opts?.taskId,
      input:    opts?.input ?? {},
      createdAt: Date.now(),
      metadata: opts?.metadata ?? {},
    };
    this.workflows.set(wf.id, wf);
    emit('PLAN_CREATED', { workflowId: wf.id, name, nodeCount: nodes.length }, {
      userId: opts?.userId, taskId: opts?.taskId,
    });
    return wf;
  }

  async run(workflowId: string): Promise<Workflow> {
    const wf = this.workflows.get(workflowId);
    if (!wf) throw new Error(`Workflow "${workflowId}" not found`);

    wf.status    = 'running';
    wf.startedAt = Date.now();
    emit('TASK_STARTED', { workflowId, name: wf.name }, { taskId: wf.taskId, userId: wf.userId });

    const graph = new WorkflowGraph(wf);

    while (!graph.isComplete() && !graph.hasFatalFailure()) {
      const ready = graph.getReadyNodes();

      if (!ready.length) {
        if (graph.isStalled()) break;
        await new Promise(r => setTimeout(r, 50)); // yield
        continue;
      }

      await Promise.all(ready.map(node => this.executeNode(node, wf)));
    }

    if (graph.hasFatalFailure()) {
      wf.status      = 'failed';
      wf.error       = 'One or more workflow nodes failed after max retries';
      wf.completedAt = Date.now();
      emit('TASK_FAILED', { workflowId, error: wf.error }, { taskId: wf.taskId, userId: wf.userId });
    } else {
      wf.status      = 'completed';
      wf.output      = graph.getCompletedOutputs();
      wf.completedAt = Date.now();
      emit('TASK_COMPLETED', { workflowId, output: wf.output }, { taskId: wf.taskId, userId: wf.userId });
    }

    return wf;
  }

  get(id: string): Workflow | null {
    return this.workflows.get(id) ?? null;
  }

  list(filter?: { userId?: string; status?: Workflow['status'] }): Workflow[] {
    let all = [...this.workflows.values()];
    if (filter?.userId) all = all.filter(w => w.userId === filter.userId);
    if (filter?.status) all = all.filter(w => w.status === filter.status);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(id: string): boolean {
    const wf = this.workflows.get(id);
    if (!wf || wf.status !== 'running') return false;
    wf.status      = 'cancelled';
    wf.completedAt = Date.now();
    for (const n of wf.nodes) {
      if (n.status === 'pending' || n.status === 'running') n.status = 'skipped';
    }
    return true;
  }

  stats() {
    const counts: Record<string, number> = {};
    for (const wf of this.workflows.values()) {
      counts[wf.status] = (counts[wf.status] ?? 0) + 1;
    }
    return { total: this.workflows.size, byStatus: counts };
  }

  private async executeNode(node: WorkflowNode, wf: Workflow): Promise<void> {
    const executor = this.executors.get(node.type);
    if (!executor) {
      node.status = 'failed';
      node.error  = `No executor for node type "${node.type}"`;
      return;
    }

    node.status    = 'running';
    node.startedAt = Date.now();
    emit('PLAN_STEP_STARTED', { workflowId: wf.id, nodeId: node.id, name: node.name }, {
      taskId: wf.taskId, userId: wf.userId,
    });

    try {
      node.output      = await executor(node, wf);
      node.status      = 'completed';
      node.completedAt = Date.now();
      emit('PLAN_STEP_COMPLETED', { workflowId: wf.id, nodeId: node.id }, {
        taskId: wf.taskId, userId: wf.userId,
      });
    } catch (err) {
      node.error = err instanceof Error ? err.message : String(err);
      node.retries++;
      if (node.retries < node.maxRetries) {
        node.status = 'pending';
        emit('RETRY_TRIGGERED', { workflowId: wf.id, nodeId: node.id, attempt: node.retries }, {
          taskId: wf.taskId,
        });
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS(node.retries)));
      } else {
        node.status      = 'failed';
        node.completedAt = Date.now();
        emit('AGENT_FAILED', { workflowId: wf.id, nodeId: node.id, error: node.error }, {
          taskId: wf.taskId, userId: wf.userId,
        });
      }
    }
  }
}

export const workflowEngine = new WorkflowEngine();
