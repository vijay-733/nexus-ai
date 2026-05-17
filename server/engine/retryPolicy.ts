// Retry policy — exponential backoff with full jitter (AWS-recommended pattern).
// Centralised here so every engine component uses the same rules.

export interface RetryConfig {
  maxAttempts:       number;   // total attempts (first try + N retries)
  baseDelayMs:       number;   // starting backoff window
  maxDelayMs:        number;   // ceiling on backoff window
  backoffMultiplier: number;   // exponent base
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts:       3,
  baseDelayMs:    1_000,
  maxDelayMs:    15_000,
  backoffMultiplier: 2,
};

// Errors where retrying can never help — stop immediately
const FATAL_PATTERNS = [
  'credit', 'forbidden', 'unauthorized', 'invalid', 'not found',
  'not registered', 'user not found', 'validation', 'bad request',
  'cancelled',
];

export function isRetryable(error: string): boolean {
  const lower = error.toLowerCase();
  return !FATAL_PATTERNS.some(p => lower.includes(p));
}

// Returns true if we should attempt again
export function shouldRetry(
  error:   string,
  attempt: number,           // 0-based: 0 = first failure, 1 = second failure ...
  cfg:     RetryConfig = DEFAULT_RETRY,
): boolean {
  return attempt + 1 < cfg.maxAttempts && isRetryable(error);
}

// Full jitter: random value in [0, cap] — avoids thundering herd at scale
export function retryDelayMs(
  attempt: number,
  cfg:     RetryConfig = DEFAULT_RETRY,
): number {
  const cap = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, attempt));
  return Math.floor(Math.random() * cap);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
