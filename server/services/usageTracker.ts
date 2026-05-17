// Usage Tracker — credit enforcement + usage recording.
//
// Credit lifecycle:
//   checkCredits(userId, tool)  → reserves credits synchronously (atomic in Node)
//   recordUsage(userId, tool, ...)  → commits or releases the reservation
//
// In-process reservation prevents double-spend when multiple requests pass
// the credit gate before any of them call recordUsage. JavaScript is
// single-threaded, so the Map operations in checkCredits are always atomic.

import { randomUUID }    from 'crypto';
import { store, type UsageRecord } from '../utils/store.js';
import { PLANS, TOOL_COSTS }       from '../utils/config.js';
import { ensureDailyRefill }       from './userService.js';
import { logger }                  from '../utils/logger.js';

export interface CreditCheck {
  allowed:          boolean;
  reason?:          string;
  creditsAvailable?: number;
  creditsRequired?:  number;
  reservationId?:   string;   // pass to recordUsage to release correctly
}

// In-process pending reservations: userId → total credits currently reserved
// across in-flight requests. Released by recordUsage regardless of outcome.
const _pendingReservations = new Map<string, number>();

function getPending(userId: string): number {
  return _pendingReservations.get(userId) ?? 0;
}

function addReservation(userId: string, amount: number): void {
  _pendingReservations.set(userId, getPending(userId) + amount);
}

function releaseReservation(userId: string, amount: number): void {
  const current = getPending(userId);
  const next    = Math.max(0, current - amount);
  if (next === 0) _pendingReservations.delete(userId);
  else            _pendingReservations.set(userId, next);
}

// Called BEFORE running a tool — enforces all limits and reserves credits.
// Pass isInternal=true for steps inside an orchestration pipeline to skip
// the per-request throttle (which would otherwise block every step after
// the first, since orchestrator waves execute back-to-back with no delay).
export function checkCredits(userId: string, tool: string, isInternal = false): CreditCheck {
  const user = ensureDailyRefill(userId);
  const plan = PLANS[user.plan];
  const cost = TOOL_COSTS[tool] ?? 1;

  // 1. Daily request ceiling
  const todayCount = store.usage.countTodayForUser(userId);
  if (todayCount >= plan.maxDailyRequests) {
    return {
      allowed: false,
      reason: `Daily request limit reached (${plan.maxDailyRequests} req/day on ${user.plan} plan). Resets in 24h.`,
    };
  }

  // 2. Per-request throttle — skipped for internal agent steps so multi-step
  //    orchestrations don't block their own sequential/parallel step calls.
  if (!isInternal) {
    const elapsed = Date.now() - user.lastRequestAt;
    if (elapsed < plan.minIntervalMs) {
      const wait = Math.ceil((plan.minIntervalMs - elapsed) / 1000);
      return {
        allowed: false,
        reason: `Request throttled — wait ${wait}s (${user.plan} plan fair-use policy).`,
      };
    }
  }

  // 3. Credit balance — subtract any in-flight reservations so concurrent
  //    requests don't collectively overdraw
  const available = user.credits - getPending(userId);
  if (available < cost) {
    return {
      allowed:          false,
      reason:           `Insufficient credits. Have ${user.credits} (${getPending(userId)} reserved), need ${cost}. Upgrade or wait for daily refill.`,
      creditsAvailable: available,
      creditsRequired:  cost,
    };
  }

  // Reserve now — atomic in single-threaded Node
  addReservation(userId, cost);

  return {
    allowed:          true,
    creditsAvailable: available,
    creditsRequired:  cost,
  };
}

// Called AFTER a tool runs — commits deduction (on success) and always releases reservation
export function recordUsage(
  userId:     string,
  tool:       string,
  provider:   string,
  status:     'success' | 'failed' | 'blocked',
  durationMs: number,
  prompt?:    string,
): UsageRecord {
  const cost = status === 'success' ? (TOOL_COSTS[tool] ?? 1) : 0;
  const user = store.users.findById(userId)!;

  // Always release the reservation regardless of outcome
  releaseReservation(userId, TOOL_COSTS[tool] ?? 1);

  // Only deduct on success; only advance throttle timestamp on success/failed
  // (not 'blocked' — blocked requests never ran, so resetting lastRequestAt
  // would permanently lock out users who retry quickly after a tool failure)
  if (cost > 0) {
    store.users.update(userId, {
      credits:          Math.max(0, user.credits - cost),
      dailyCreditsUsed: user.dailyCreditsUsed + cost,
      lastRequestAt:    Date.now(),
    });
  } else if (status === 'failed') {
    store.users.update(userId, { lastRequestAt: Date.now() });
  }
  // status === 'blocked': do not update lastRequestAt

  const record: UsageRecord = {
    id:          randomUUID(),
    userId,
    tool,
    provider,
    creditsUsed: cost,
    status,
    prompt:      prompt?.slice(0, 200),
    durationMs,
    timestamp:   Date.now(),
  };

  store.usage.add(record);
  logger.info('usage', `[${status}] ${tool}@${provider} user=${userId} cost=${cost} dur=${durationMs}ms`);
  return record;
}
