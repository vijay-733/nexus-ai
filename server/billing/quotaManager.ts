import { creditsSystem } from './creditsSystem.js';
import { getPlan } from './plans.js';

export interface QuotaResult {
  allowed: boolean;
  reason?: string;
  remaining: number;
}

interface Bucket { count: number; resetAt: number; }

const minuteBuckets = new Map<string, Bucket>();
const hourBuckets   = new Map<string, Bucket>();
const dayBuckets    = new Map<string, Bucket>();

function getBucket(map: Map<string, Bucket>, key: string, windowMs: number): Bucket {
  const now      = Date.now();
  const existing = map.get(key);
  if (existing && existing.resetAt > now) return existing;
  const fresh = { count: 0, resetAt: now + windowMs };
  map.set(key, fresh);
  return fresh;
}

export function checkRateLimit(userId: string): QuotaResult {
  const acct   = creditsSystem.getOrCreate(userId);
  const plan   = getPlan(acct.planId);
  const { rateLimit } = plan;

  const min  = getBucket(minuteBuckets, userId, 60_000);
  const hr   = getBucket(hourBuckets,   userId, 3_600_000);
  const day  = getBucket(dayBuckets,    userId, 86_400_000);

  if (min.count  >= rateLimit.requestsPerMinute) {
    return { allowed: false, reason: `Rate limit: ${rateLimit.requestsPerMinute} req/min exceeded`, remaining: 0 };
  }
  if (hr.count   >= rateLimit.requestsPerHour) {
    return { allowed: false, reason: `Rate limit: ${rateLimit.requestsPerHour} req/hr exceeded`, remaining: 0 };
  }
  if (day.count  >= rateLimit.requestsPerDay) {
    return { allowed: false, reason: `Rate limit: ${rateLimit.requestsPerDay} req/day exceeded`, remaining: 0 };
  }

  min.count++;
  hr.count++;
  day.count++;
  return { allowed: true, remaining: acct.credits };
}

export function checkQuota(userId: string): QuotaResult {
  const acct = creditsSystem.getOrCreate(userId);
  if (acct.credits <= 0) {
    return { allowed: false, reason: 'No credits remaining', remaining: 0 };
  }
  return checkRateLimit(userId);
}

export function deductCredits(userId: string, action: string): QuotaResult {
  const rate = checkRateLimit(userId);
  if (!rate.allowed) return rate;

  const result = creditsSystem.deduct(userId, action);
  if (!result.success) {
    return { allowed: false, reason: result.reason, remaining: result.balance };
  }
  return { allowed: true, remaining: result.balance };
}
