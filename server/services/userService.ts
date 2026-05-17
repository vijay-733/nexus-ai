import bcrypt       from 'bcryptjs';
import { randomUUID } from 'crypto';
import { store, type User, type PlanName } from '../utils/store.js';
import { PLANS }                           from '../utils/config.js';

export async function registerUser(
  email: string, name: string, password: string, plan: PlanName = 'free'
): Promise<User> {
  const passwordHash = await bcrypt.hash(password, 12);
  const cfg          = PLANS[plan];

  const user: User = {
    id:               randomUUID(),
    email:            email.toLowerCase().trim(),
    name:             name.trim(),
    passwordHash,
    plan,
    credits:          cfg.initialCredits,
    dailyCreditsUsed: 0,
    dailyResetAt:     Date.now() + 86_400_000,
    lastRequestAt:    0,
    createdAt:        Date.now(),
  };

  return store.users.create(user);
}

export async function loginUser(email: string, password: string): Promise<User | null> {
  const user = store.users.findByEmail(email.toLowerCase().trim());
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

// Lazily refill daily credits — called on every agent request
export function ensureDailyRefill(userId: string): User {
  const user = store.users.findById(userId);
  if (!user) throw new Error('User not found');
  if (Date.now() < user.dailyResetAt) return user;

  const cfg = PLANS[user.plan];
  const refilled = Math.min(user.credits + cfg.dailyRefill, cfg.initialCredits);
  return store.users.update(userId, {
    credits:          refilled,
    dailyCreditsUsed: 0,
    dailyResetAt:     Date.now() + 86_400_000,
  });
}

// Strip passwordHash before sending to client
export function publicUser(u: User) {
  const { passwordHash: _, ...pub } = u;
  return pub;
}
