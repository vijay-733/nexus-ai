export type JobStatus   = 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled';
export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

export interface Job<P = unknown> {
  id: string;
  type: string;
  payload: P;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  userId?: string;
  taskId?: string;
  timeoutMs?: number;
}

export interface QueueAdapter {
  enqueue<P>(
    type: string,
    payload: P,
    opts?: Partial<Pick<Job, 'priority' | 'maxAttempts' | 'userId' | 'taskId' | 'timeoutMs'>>
  ): Promise<Job<P>>;
  dequeue(types?: string[]): Promise<Job | null>;
  complete(jobId: string, result: unknown): Promise<void>;
  fail(jobId: string, error: string): Promise<void>;
  get(jobId: string): Promise<Job | null>;
  list(filter?: { status?: JobStatus; type?: string; userId?: string }): Promise<Job[]>;
  size(type?: string): Promise<number>;
}
