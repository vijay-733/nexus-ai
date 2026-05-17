// Task Store — single source of truth for all engine task state.
//
// Storage:  in-memory Map (primary) + JSON file (persistence across restarts).
// On startup: loads tasks.json, resets any non-terminal tasks to 'failed'
//             (they were interrupted by the restart and cannot be resumed).
// On writes:  debounced flush to disk every 2 s for non-critical updates;
//             terminal state transitions flush immediately so data is never lost.
// Eviction:   when total tasks exceed MAX_TASKS_TOTAL, oldest completed tasks
//             are dropped so the Map never grows unbounded.

import fs   from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger }     from '../utils/logger.js';

const DATA_DIR   = path.join(process.cwd(), 'server', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

// ── Full lifecycle state machine ───────────────────────────────────────────────
//
//  queued → initializing → planning → running → done
//                                            ↘ partial    (some steps failed)
//                                            ↘ retrying → running | failed
//                                            ↘ failed
//                                            ↘ cancelled
//        streaming is a sub-state of running (future SSE support)
//        recovered = engine recovered task from a transient error

export type TaskStatus =
  | 'queued'        // created, waiting in queue
  | 'initializing'  // picked up, pre-flight credit/governance check
  | 'planning'      // planner agent decomposing task
  | 'running'       // worker agents executing
  | 'streaming'     // streaming response back (SSE mode)
  | 'retrying'      // waiting for exponential backoff between retries
  | 'done'          // fully completed
  | 'partial'       // completed with some steps failed (partial success)
  | 'failed'        // all attempts exhausted
  | 'recovered'     // recovered from transient error, restarted
  | 'cancelled';    // cancelled by user or governance

export type TaskKind     = 'multi' | 'react' | 'single';
export type TaskPriority = 'high' | 'normal' | 'low';
export type StepStatus   = 'pending' | 'running' | 'done' | 'failed' | 'retrying';

export interface TaskStep {
  id:           string;
  type:         string;
  description:  string;
  status:       StepStatus;
  input:        string;
  output?:      string;
  provider?:    string;
  error?:       string;
  startedAt?:   number;
  completedAt?: number;
  durationMs?:  number;
  retryCount:   number;
}

export interface TaskLog {
  ts:    number;
  level: 'info' | 'warn' | 'error' | 'debug';
  ctx:   string;
  msg:   string;
  data?: unknown;
}

export interface TaskResult {
  success: boolean;
  output:  string;
  data?:   unknown;
}

export interface Task {
  id:           string;
  userId:       string;
  kind:         TaskKind;
  status:       TaskStatus;
  priority:     TaskPriority;
  input:        string;
  options?:     Record<string, unknown>;
  steps:        TaskStep[];
  result?:      TaskResult;
  logs:         TaskLog[];
  creditsUsed:  number;
  retryCount:   number;
  maxRetries:   number;
  createdAt:    number;
  startedAt?:   number;
  completedAt?: number;
  durationMs?:  number;
  error?:       string;
}

export interface CreateTaskParams {
  userId:      string;
  kind:        TaskKind;
  priority?:   TaskPriority;
  input:       string;
  options?:    Record<string, unknown>;
  maxRetries?: number;
}

const MAX_TASKS_TOTAL   = 500;
const MAX_LOGS_PER_TASK = 200;
const TERMINAL_STATES   = new Set<TaskStatus>(['done', 'partial', 'failed', 'cancelled', 'recovered']);

const _tasks = new Map<string, Task>();
let   _dirty = false;

// ── Disk persistence ──────────────────────────────────────────────────────────

function saveToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TASKS_FILE, JSON.stringify([..._tasks.values()], null, 0), 'utf8');
    _dirty = false;
  } catch (err) {
    logger.error('task-store', 'persist failed', err instanceof Error ? err.message : err);
  }
}

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(TASKS_FILE)) return;
    const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')) as Task[];
    for (const t of tasks) _tasks.set(t.id, t);
    logger.info('task-store', `loaded ${tasks.length} task(s) from disk`);
  } catch (err) {
    logger.warn('task-store', 'load failed — starting empty', err instanceof Error ? err.message : err);
  }
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (_dirty) saveToDisk();
  }, 2_000);
}

// Immediate flush for terminal/critical state changes — never debounce these
function saveNow(): void {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  saveToDisk();
}

// ── Eviction ──────────────────────────────────────────────────────────────────

function evictIfNeeded(): void {
  if (_tasks.size <= MAX_TASKS_TOTAL) return;
  const evictable = [..._tasks.values()]
    .filter(t => TERMINAL_STATES.has(t.status))
    .sort((a, b) => a.createdAt - b.createdAt);
  const toRemove = _tasks.size - Math.floor(MAX_TASKS_TOTAL * 0.9);
  evictable.slice(0, toRemove).forEach(t => _tasks.delete(t.id));
  if (toRemove > 0) logger.info('task-store', `evicted ${toRemove} completed task(s)`);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const taskStore = {

  init(): void {
    loadFromDisk();
    let recovered = 0;
    for (const t of _tasks.values()) {
      // Any non-terminal task on startup was interrupted — mark failed
      if (!TERMINAL_STATES.has(t.status)) {
        t.status      = 'failed';
        t.error       = 'Server restarted while task was in progress';
        t.completedAt = Date.now();
        t.durationMs  = t.startedAt ? t.completedAt - t.startedAt : 0;
        recovered++;
      }
    }
    if (recovered > 0) {
      logger.info('task-store', `marked ${recovered} interrupted task(s) as failed`);
      saveNow();
    }
  },

  create(params: CreateTaskParams): Task {
    evictIfNeeded();
    const task: Task = {
      id:          randomUUID(),
      userId:      params.userId,
      kind:        params.kind,
      status:      'queued',
      priority:    params.priority ?? 'normal',
      input:       params.input,
      options:     params.options,
      steps:       [],
      logs:        [],
      creditsUsed: 0,
      retryCount:  0,
      maxRetries:  params.maxRetries ?? 2,
      createdAt:   Date.now(),
    };
    _tasks.set(task.id, task);
    scheduleSave();
    return task;
  },

  get(id: string): Task | undefined {
    return _tasks.get(id);
  },

  listForUser(userId: string, limit = 20): Task[] {
    return [..._tasks.values()]
      .filter(t => t.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  update(id: string, patch: Partial<Task>): Task | undefined {
    const t = _tasks.get(id);
    if (!t) return undefined;
    Object.assign(t, patch);
    scheduleSave();
    return t;
  },

  setStatus(id: string, status: TaskStatus): void {
    const t = _tasks.get(id);
    if (!t) return;
    t.status = status;
    if (status === 'running' && !t.startedAt) t.startedAt = Date.now();
    if (TERMINAL_STATES.has(status)) {
      t.completedAt = Date.now();
      t.durationMs  = t.startedAt ? t.completedAt - t.startedAt : 0;
      // Immediately flush terminal states — don't risk data loss on crash
      saveNow();
      return;
    }
    scheduleSave();
  },

  addStep(taskId: string, step: Omit<TaskStep, 'retryCount'>): TaskStep {
    const t    = _tasks.get(taskId);
    const full: TaskStep = { ...step, retryCount: 0 };
    t?.steps.push(full);
    scheduleSave();
    return full;
  },

  updateStep(taskId: string, stepId: string, patch: Partial<TaskStep>): void {
    const step = _tasks.get(taskId)?.steps.find(s => s.id === stepId);
    if (step) { Object.assign(step, patch); scheduleSave(); }
  },

  log(
    id:    string,
    level: TaskLog['level'],
    ctx:   string,
    msg:   string,
    data?: unknown,
  ): void {
    const t = _tasks.get(id);
    if (!t) return;
    if (t.logs.length >= MAX_LOGS_PER_TASK) t.logs.shift();
    const entry: TaskLog = { ts: Date.now(), level, ctx, msg };
    if (data !== undefined) entry.data = data;
    t.logs.push(entry);
    scheduleSave();
  },

  setResult(id: string, result: TaskResult, creditsUsed: number): void {
    const t = _tasks.get(id);
    if (!t) return;
    t.result      = result;
    t.creditsUsed = creditsUsed;
    scheduleSave();
  },

  cancel(id: string, userId: string): boolean {
    const t = _tasks.get(id);
    if (!t || t.userId !== userId) return false;
    if (TERMINAL_STATES.has(t.status)) return false;
    t.status      = 'cancelled';
    t.completedAt = Date.now();
    t.durationMs  = t.startedAt ? t.completedAt - t.startedAt : 0;
    saveNow();
    return true;
  },

  delete(id: string, userId: string): boolean {
    const t = _tasks.get(id);
    if (!t || t.userId !== userId) return false;
    _tasks.delete(id);
    scheduleSave();
    return true;
  },

  stats(): { total: number; byStatus: Record<string, number> } {
    const byStatus: Record<string, number> = {};
    for (const t of _tasks.values()) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    }
    return { total: _tasks.size, byStatus };
  },

  flush(): void {
    if (_dirty) saveToDisk();
  },
};

// ── Lifecycle hooks ───────────────────────────────────────────────────────────

taskStore.init();
process.on('exit',    () => taskStore.flush());
process.on('SIGINT',  () => { taskStore.flush(); process.exit(0); });
process.on('SIGTERM', () => { taskStore.flush(); process.exit(0); });
