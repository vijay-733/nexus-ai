// Shared session memory for multi-agent execution.
// One Session = one full user request from plan through final answer.
// Stored in-process (Map). TTL eviction prevents unbounded growth.
// Thread-safe for single-process Node; swap for Redis if you scale horizontally.

const SESSION_TTL_MS  = 60 * 60_000;   // keep sessions for 1 hour
const PRUNE_INTERVAL  = 10 * 60_000;   // scan for stale sessions every 10 min

// ── Public types ──────────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
export type StepType   = 'text' | 'image';

export interface PlanStep {
  id:          string;
  type:        StepType;
  task:        string;
  description?: string;   // short UI label (5-10 words); falls back to task in the UI
  dependsOn:   string[];  // step IDs that must be 'done' before this one starts
  status:      StepStatus;
}

export interface StepOutput {
  stepId:     string;
  type:       StepType;
  content:    string;    // text body or image data-URL
  provider:   string;
  durationMs: number;
  timestamp:  number;
  error?:     string;
}

export interface AgentSession {
  id:           string;
  userId:       string;
  originalTask: string;
  plan:         PlanStep[];
  outputs:      Record<string, StepOutput>;   // keyed by stepId
  context:      Record<string, unknown>;      // arbitrary agent scratch-space
  createdAt:    number;
  updatedAt:    number;
}

// ── Internal store ────────────────────────────────────────────────────────────

const _sessions = new Map<string, AgentSession>();

// Background pruning — prevents Map from growing indefinitely on long-running servers
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of _sessions) {
    if (s.updatedAt < cutoff) _sessions.delete(id);
  }
}, PRUNE_INTERVAL).unref();

// ── Public API ────────────────────────────────────────────────────────────────

export const sharedMemory = {

  create(session: AgentSession): void {
    _sessions.set(session.id, session);
  },

  get(sessionId: string): AgentSession | undefined {
    return _sessions.get(sessionId);
  },

  // Replace the entire plan (called after Planner returns)
  updatePlan(sessionId: string, plan: PlanStep[]): void {
    const s = _sessions.get(sessionId);
    if (!s) return;
    s.plan      = plan;
    s.updatedAt = Date.now();
  },

  // Update a single step's status (pending → running → done/failed)
  setStepStatus(sessionId: string, stepId: string, status: StepStatus): void {
    const s = _sessions.get(sessionId);
    if (!s) return;
    const step = s.plan.find(p => p.id === stepId);
    if (step) step.status = status;
    s.updatedAt = Date.now();
  },

  // Persist a worker's output for a step
  saveOutput(sessionId: string, output: StepOutput): void {
    const s = _sessions.get(sessionId);
    if (!s) return;
    s.outputs[output.stepId] = output;
    s.updatedAt = Date.now();
  },

  // Write arbitrary key-value context (e.g. tone detected by one agent for another)
  setContext(sessionId: string, key: string, value: unknown): void {
    const s = _sessions.get(sessionId);
    if (!s) return;
    s.context[key] = value;
    s.updatedAt = Date.now();
  },

  delete(sessionId: string): void {
    _sessions.delete(sessionId);
  },

  // Build a context string from the outputs of a step's declared dependencies.
  // Workers call this to inject prior results into their prompts.
  buildContext(sessionId: string, dependsOn: string[]): string {
    if (dependsOn.length === 0) return '';
    const s = _sessions.get(sessionId);
    if (!s) return '';

    return dependsOn
      .map(id => {
        const out = s.outputs[id];
        if (!out) return null;
        if (out.type === 'image') return `[Step ${id} produced an image via ${out.provider}]`;
        return `[Step ${id} output]:\n${out.content.slice(0, 2_000)}`;
      })
      .filter((x): x is string => x !== null)
      .join('\n\n');
  },

  size(): number {
    return _sessions.size;
  },
};
