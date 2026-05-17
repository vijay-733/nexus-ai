export class ExecutionGuard {
  private stepCount = 0;
  private readonly maxSteps: number;
  private readonly startedAt: number;
  private readonly timeoutMs: number;
  private recentOutputs: string[] = [];

  constructor(maxSteps = 50, timeoutMs = 5 * 60_000) {
    this.maxSteps  = maxSteps;
    this.timeoutMs = timeoutMs;
    this.startedAt = Date.now();
  }

  checkStep(outputSummary?: string): void {
    this.stepCount++;

    if (this.stepCount > this.maxSteps) {
      throw new Error(`Execution exceeded max steps (${this.maxSteps})`);
    }

    if (Date.now() - this.startedAt > this.timeoutMs) {
      throw new Error(`Execution timed out after ${this.timeoutMs}ms`);
    }

    if (outputSummary) {
      this.recentOutputs.push(outputSummary);
      if (this.recentOutputs.length > 5) this.recentOutputs.shift();

      if (this.recentOutputs.length >= 3) {
        const last3 = this.recentOutputs.slice(-3);
        if (last3.every(o => o === last3[0])) {
          throw new Error('Execution loop detected: identical output repeated 3 times');
        }
      }
    }
  }

  get steps(): number   { return this.stepCount; }
  get elapsed(): number { return Date.now() - this.startedAt; }
  get remaining(): number { return Math.max(0, this.maxSteps - this.stepCount); }
}
