// In-memory bounded priority queue with configurable concurrency.
// Tasks within the same priority bucket execute FIFO.
// Drop-in replacement path: swap processor + enqueue calls for BullMQ + Redis
// when you need multi-process or durable queuing.

import { logger } from '../utils/logger.js';

export type QueuePriority = 'high' | 'normal' | 'low';

interface QueueEntry<T> {
  id:       string;
  payload:  T;
  priority: QueuePriority;
  addedAt:  number;
}

// Lower rank = higher urgency
const PRIORITY_RANK: Record<QueuePriority, number> = { high: 0, normal: 1, low: 2 };

export class TaskQueue<T> {
  private readonly _queue:       QueueEntry<T>[] = [];
  private          _running      = 0;
  private readonly _maxParallel: number;
  private readonly _process:     (id: string, payload: T) => Promise<void>;

  constructor(
    process:     (id: string, payload: T) => Promise<void>,
    maxParallel  = 3,
  ) {
    this._process     = process;
    this._maxParallel = maxParallel;
  }

  enqueue(id: string, payload: T, priority: QueuePriority = 'normal'): void {
    this._queue.push({ id, payload, priority, addedAt: Date.now() });
    // Stable sort: priority bucket first, arrival time within bucket
    this._queue.sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) ||
        (a.addedAt - b.addedAt),
    );
    logger.debug('queue', `+enqueue id=${id} priority=${priority} depth=${this._queue.length}`);
    this._drain();
  }

  // Remove a waiting entry (won't stop an already-running task)
  remove(id: string): boolean {
    const idx = this._queue.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this._queue.splice(idx, 1);
    logger.debug('queue', `-remove id=${id}`);
    return true;
  }

  stats() {
    return {
      queued:  this._queue.length,
      running: this._running,
      byPriority: {
        high:   this._queue.filter(e => e.priority === 'high').length,
        normal: this._queue.filter(e => e.priority === 'normal').length,
        low:    this._queue.filter(e => e.priority === 'low').length,
      },
    };
  }

  private _drain(): void {
    while (this._running < this._maxParallel && this._queue.length > 0) {
      const entry = this._queue.shift()!;
      this._running++;
      logger.info('queue', `start id=${entry.id} running=${this._running}/${this._maxParallel}`);

      this._process(entry.id, entry.payload)
        .catch(err =>
          logger.error('queue', `unhandled error id=${entry.id}`, err instanceof Error ? err.message : err),
        )
        .finally(() => {
          this._running--;
          logger.info('queue', `done  id=${entry.id} running=${this._running}/${this._maxParallel}`);
          this._drain();
        });
    }
  }
}
