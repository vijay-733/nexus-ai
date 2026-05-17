import type { Workflow, WorkflowNode } from './workflowTypes.js';

export class WorkflowGraph {
  constructor(private wf: Workflow) {}

  getReadyNodes(): WorkflowNode[] {
    return this.wf.nodes.filter(node => {
      if (node.status !== 'pending') return false;
      return node.dependencies.every(depId => {
        const dep = this.getNode(depId);
        return dep?.status === 'completed' || dep?.status === 'skipped';
      });
    });
  }

  getNode(id: string): WorkflowNode | undefined {
    return this.wf.nodes.find(n => n.id === id);
  }

  isComplete(): boolean {
    return this.wf.nodes.every(n =>
      n.status === 'completed' || n.status === 'skipped'
    );
  }

  hasFatalFailure(): boolean {
    return this.wf.nodes.some(n => n.status === 'failed' && n.retries >= n.maxRetries);
  }

  isStalled(): boolean {
    const active = this.wf.nodes.some(n => n.status === 'running' || n.status === 'pending');
    const ready  = this.getReadyNodes().length;
    return active && ready === 0 && !this.isComplete();
  }

  getCompletedOutputs(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const n of this.wf.nodes) {
      if (n.status === 'completed') out[n.id] = n.output;
    }
    return out;
  }

  topologicalOrder(): WorkflowNode[] {
    const visited = new Set<string>();
    const result: WorkflowNode[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = this.getNode(id);
      if (!node) return;
      for (const dep of node.dependencies) visit(dep);
      result.push(node);
    };
    for (const node of this.wf.nodes) visit(node.id);
    return result;
  }

  progress(): { total: number; completed: number; failed: number; running: number; pct: number } {
    const total     = this.wf.nodes.length;
    const completed = this.wf.nodes.filter(n => n.status === 'completed').length;
    const failed    = this.wf.nodes.filter(n => n.status === 'failed').length;
    const running   = this.wf.nodes.filter(n => n.status === 'running').length;
    return { total, completed, failed, running, pct: total ? Math.round((completed / total) * 100) : 0 };
  }
}
