import { globalEventBus } from '../events/eventBus.js';

export interface SafetyConfig {
  maxSteps: number;
  maxRetries: number;
  stepTimeoutMs: number;
  totalTimeoutMs: number;
  maxInputLength: number;
  maxOutputLength: number;
  loopDetectionWindow: number;
  allowedTools?: string[];
  blockedTools?: string[];
}

export interface SafetyViolation {
  type:
    | 'max_steps' | 'max_retries' | 'step_timeout' | 'total_timeout'
    | 'input_too_long' | 'output_too_long' | 'loop_detected' | 'tool_blocked';
  message: string;
  step?: number;
  elapsed?: number;
}

const DEFAULT_CONFIG: SafetyConfig = {
  maxSteps:            50,
  maxRetries:           3,
  stepTimeoutMs:   60_000,
  totalTimeoutMs: 600_000,
  maxInputLength:  50_000,
  maxOutputLength: 100_000,
  loopDetectionWindow: 5,
};

export class SafetyGuard {
  private config: SafetyConfig;
  private stepCount   = 0;
  private retryCount  = 0;
  private startedAt   = Date.now();
  private stepStartAt = Date.now();
  private outputHashes: string[] = [];
  private taskId?: string;
  private userId?: string;

  constructor(
    config: Partial<SafetyConfig> = {},
    meta?: { taskId?: string; userId?: string }
  ) {
    this.config  = { ...DEFAULT_CONFIG, ...config };
    this.taskId  = meta?.taskId;
    this.userId  = meta?.userId;
  }

  beginStep(): void {
    this.stepCount++;
    this.stepStartAt = Date.now();
  }

  checkStep(output?: string): SafetyViolation | null {
    const now = Date.now();

    if (this.stepCount > this.config.maxSteps) {
      return this.emit('max_steps', `Exceeded max steps (${this.config.maxSteps})`);
    }
    if (now - this.startedAt > this.config.totalTimeoutMs) {
      return this.emit('total_timeout',
        `Total timeout exceeded (${this.config.totalTimeoutMs}ms)`,
        { elapsed: now - this.startedAt }
      );
    }
    if (now - this.stepStartAt > this.config.stepTimeoutMs) {
      return this.emit('step_timeout',
        `Step ${this.stepCount} timed out after ${this.config.stepTimeoutMs}ms`,
        { step: this.stepCount, elapsed: now - this.stepStartAt }
      );
    }
    if (output !== undefined) {
      if (output.length > this.config.maxOutputLength) {
        return this.emit('output_too_long',
          `Output length ${output.length} exceeds max ${this.config.maxOutputLength}`
        );
      }
      const h = this.djb2(output);
      this.outputHashes.push(h);
      if (this.outputHashes.length > this.config.loopDetectionWindow) this.outputHashes.shift();
      if (this.outputHashes.length >= 3) {
        const tail = this.outputHashes.slice(-3);
        if (tail.every(x => x === tail[0])) {
          return this.emit('loop_detected', 'Identical output repeated 3 times — infinite loop detected');
        }
      }
    }
    return null;
  }

  checkInput(input: string): SafetyViolation | null {
    if (input.length > this.config.maxInputLength) {
      return this.emit('input_too_long',
        `Input length ${input.length} exceeds max ${this.config.maxInputLength}`
      );
    }
    return null;
  }

  checkTool(toolName: string): SafetyViolation | null {
    if (this.config.blockedTools?.includes(toolName)) {
      return this.emit('tool_blocked', `Tool "${toolName}" is blocked in this context`);
    }
    if (this.config.allowedTools && !this.config.allowedTools.includes(toolName)) {
      return this.emit('tool_blocked', `Tool "${toolName}" is not in the allowed list`);
    }
    return null;
  }

  recordRetry(): boolean {
    this.retryCount++;
    if (this.retryCount > this.config.maxRetries) {
      this.emit('max_retries', `Exceeded max retries (${this.config.maxRetries})`);
      return false;
    }
    return true;
  }

  get steps():   number { return this.stepCount; }
  get retries(): number { return this.retryCount; }
  get elapsed(): number { return Date.now() - this.startedAt; }

  summary() {
    return {
      steps:    this.stepCount,
      retries:  this.retryCount,
      elapsedMs: this.elapsed,
      maxSteps: this.config.maxSteps,
      maxRetries: this.config.maxRetries,
    };
  }

  private emit(
    type: SafetyViolation['type'],
    message: string,
    extra?: Partial<SafetyViolation>
  ): SafetyViolation {
    const v: SafetyViolation = {
      type, message,
      step:    this.stepCount,
      elapsed: this.elapsed,
      ...extra,
    };
    globalEventBus.createEmitter('safety-guard')('SAFETY_VIOLATION', v, {
      taskId: this.taskId,
      userId: this.userId,
    });
    return v;
  }

  private djb2(s: string): string {
    let h = 5381;
    const len = Math.min(s.length, 500);
    for (let i = 0; i < len; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return String(h >>> 0);
  }
}

export function createSafetyGuard(
  config?: Partial<SafetyConfig>,
  meta?: { taskId?: string; userId?: string }
): SafetyGuard {
  return new SafetyGuard(config, meta);
}
