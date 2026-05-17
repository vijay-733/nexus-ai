import rateLimit from 'express-rate-limit';

const json = (msg: string) => ({ error: msg });

// Strict limiter for auth endpoints — prevents brute-force
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min window
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json('Too many auth attempts. Try again in 15 minutes.'),
});

// Per-IP limiter for agent endpoint (user-level throttle is in usageTracker)
export const agentLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 min window
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: json('IP rate limit: max 60 agent calls/min. Your per-plan limit may be lower.'),
});

// General catch-all
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: json('Too many requests from this IP. Slow down.'),
});
