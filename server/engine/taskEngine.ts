// Task Execution Engine — entry point for all AI work.
//
// Two execution modes:
//   runTaskSync(req)     — execute now, block HTTP, return full Task.
//   submitTaskAsync(req) — enqueue, return taskId immediately (HTTP 202).
//
// Lifecycle state transitions:
//   queued → initializing → planning → running → done | partial | failed
//                                              ↘ retrying → running | failed
//   Any state → cancelled (user/governance interrupt)
//
// Safety:
//   - Fatal errors (credits, auth, validation) never retried
//   - Each retry waits with full-jitter backoff
//   - Overall TASK_TIMEOUT_MS deadline cuts hung LLM calls via AbortSignal
//   - Background queue caps at 3 concurrent tasks

import {
  taskStore,
  type Task,
  type TaskKind,
  type TaskPriority,
}                                          from '../state/taskStore.js';
import { TaskQueue, type QueuePriority }   from './taskQueue.js';
import { dispatchToAgent }                 from './agentController.js';
import {
  DEFAULT_RETRY,
  shouldRetry,
  retryDelayMs,
  sleep,
}                                          from './retryPolicy.js';
import { checkCredits }                    from '../services/usageTracker.js';
import { logger }                          from '../utils/logger.js';

export interface TaskRequest {
  userId:      string;
  kind:        TaskKind;
  input:       string;
  priority?:   TaskPriority;
  options?:    Record<string, unknown>;
  maxRetries?: number;
}

// Hard deadline for a single task — prevents zombie tasks from hanging forever.
// Set slightly above the agent-level timeouts so agents can clean up first.
const TASK_TIMEOUT_MS = 130_000;

async function executeTask(task: Task): Promise<void> {
  const t0            = Date.now();
  // Create an AbortSignal that fires at the overall task deadline.
  // Passed down into agent calls so LLM fetches abort cleanly.
  const taskSignal    = AbortSignal.timeout(TASK_TIMEOUT_MS);

  taskStore.setStatus(task.id, 'initializing');
  taskStore.log(task.id, 'info', 'engine', `started kind=${task.kind} priority=${task.priority}`);
  logger.info('engine', `execute taskId=${task.id} kind=${task.kind} user=${task.userId}`);

  // ── Credit pre-check ────────────────────────────────────────────────────────
  const guardTool   = task.kind === 'single' && task.options?.task === 'image'
    ? 'image-generation'
    : 'text-generation';
  const creditCheck = checkCredits(task.userId, guardTool);

  if (!creditCheck.allowed) {
    const reason = creditCheck.reason ?? 'Insufficient credits';
    taskStore.setStatus(task.id, 'failed');
    taskStore.update(task.id, { error: reason });
    taskStore.log(task.id, 'warn', 'engine', `credit blocked: ${reason}`);
    logger.warn('engine', `taskId=${task.id} credit blocked`);
    return;
  }

  // ── Retry loop ──────────────────────────────────────────────────────────────
  let totalCredits = 0;
  let lastError    = '';

  for (let attempt = 0; attempt < DEFAULT_RETRY.maxAttempts; attempt++) {

    if (taskSignal.aborted) {
      lastError = 'Task deadline exceeded';
      taskStore.log(task.id, 'warn', 'engine', `task timeout after ${Date.now() - t0}ms`);
      break;
    }

    // Check if task was cancelled between attempts
    const current = taskStore.get(task.id);
    if (current?.status === 'cancelled') {
      logger.info('engine', `taskId=${task.id} cancelled — stopping`);
      return;
    }

    if (attempt > 0) {
      const delay = retryDelayMs(attempt - 1, DEFAULT_RETRY);
      taskStore.setStatus(task.id, 'retrying');
      taskStore.update(task.id, { retryCount: attempt });
      taskStore.log(task.id, 'info', 'engine', `retry ${attempt}/${DEFAULT_RETRY.maxAttempts - 1} after ${delay}ms`);
      logger.info('engine', `taskId=${task.id} retry ${attempt} delay=${delay}ms`);
      await sleep(delay);

      if (taskStore.get(task.id)?.status === 'cancelled') return;
      if (taskSignal.aborted) { lastError = 'Task deadline exceeded during retry wait'; break; }
    }

    // Transition to planning before dispatching
    taskStore.setStatus(task.id, attempt === 0 ? 'planning' : 'running');
    taskStore.log(task.id, 'info', 'engine',
      `attempt ${attempt + 1}/${DEFAULT_RETRY.maxAttempts} — dispatching to ${task.kind} agent`);

    const result = await dispatchToAgent(task, taskSignal);
    totalCredits += result.credits;

    if (result.success) {
      // Determine final state: 'partial' if agent succeeded but noted partial results
      const isFinallyDone = result.output && result.output.length > 0;
      taskStore.setStatus(task.id, isFinallyDone ? 'done' : 'partial');
      taskStore.setResult(
        task.id,
        { success: true, output: result.output, data: result.data },
        totalCredits,
      );
      taskStore.log(
        task.id, 'info', 'engine',
        `done steps=${result.stepCount} credits=${totalCredits} dur=${Date.now() - t0}ms`,
      );
      logger.info('engine', `taskId=${task.id} DONE dur=${Date.now() - t0}ms credits=${totalCredits}`);
      return;
    }

    lastError = result.error ?? 'Unknown error';
    taskStore.log(task.id, 'warn', 'engine', `attempt ${attempt + 1} failed: ${lastError}`);
    logger.warn('engine', `taskId=${task.id} attempt ${attempt + 1} failed: ${lastError}`);

    if (!shouldRetry(lastError, attempt, DEFAULT_RETRY)) {
      taskStore.log(task.id, 'warn', 'engine', `non-retryable error — stopping`);
      logger.warn('engine', `taskId=${task.id} non-retryable — no more retries`);
      break;
    }
  }

  // ── All attempts exhausted ─────────────────────────────────────────────────
  taskStore.setStatus(task.id, 'failed');
  taskStore.update(task.id, {
    error:       lastError.slice(0, 500),  // cap error length
    creditsUsed: totalCredits,
  });
  taskStore.setResult(task.id, { success: false, output: '' }, totalCredits);
  taskStore.log(task.id, 'error', 'engine',
    `failed after ${DEFAULT_RETRY.maxAttempts} attempt(s): ${lastError}`);
  logger.error('engine', `taskId=${task.id} FAILED: ${lastError}`);
}

// ── Background queue (async mode) ─────────────────────────────────────────────

const _bgQueue = new TaskQueue<{ taskId: string }>(
  async (_qid, { taskId }) => {
    const task = taskStore.get(taskId);
    if (!task) { logger.warn('engine', `queued taskId=${taskId} not found in store`); return; }
    if (task.status === 'cancelled') return;
    await executeTask(task);
  },
  3,
);

// ── Public API ────────────────────────────────────────────────────────────────

export async function runTaskSync(req: TaskRequest): Promise<Task> {
  const task = taskStore.create({
    userId:     req.userId,
    kind:       req.kind,
    priority:   req.priority ?? 'normal',
    input:      req.input,
    options:    req.options,
    maxRetries: req.maxRetries ?? DEFAULT_RETRY.maxAttempts - 1,
  });
  taskStore.log(task.id, 'info', 'engine', `sync submission input="${req.input.slice(0, 80)}"`);
  await executeTask(task);
  return taskStore.get(task.id)!;
}

export function submitTaskAsync(req: TaskRequest): string {
  const task = taskStore.create({
    userId:     req.userId,
    kind:       req.kind,
    priority:   req.priority ?? 'normal',
    input:      req.input,
    options:    req.options,
    maxRetries: req.maxRetries ?? DEFAULT_RETRY.maxAttempts - 1,
  });
  taskStore.log(task.id, 'info', 'engine', `async submission queued`);
  _bgQueue.enqueue(task.id, { taskId: task.id }, task.priority as QueuePriority);
  logger.info('engine', `taskId=${task.id} queued (async) depth=${_bgQueue.stats().queued}`);
  return task.id;
}

export function cancelTask(taskId: string, userId: string): boolean {
  const removed   = _bgQueue.remove(taskId);
  const cancelled = taskStore.cancel(taskId, userId);
  return removed || cancelled;
}

export function queueStats() {
  return { queue: _bgQueue.stats(), store: taskStore.stats() };
}
