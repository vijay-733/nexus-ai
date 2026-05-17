// File-based JSON store — production-swap-ready (replace with Postgres/Mongo by
// implementing the same interface). All writes are synchronous to keep things
// simple without a migration layer.

import fs   from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

// ── Domain types ──────────────────────────────────────────────────────────────

export type PlanName = 'free' | 'pro' | 'enterprise';

export interface User {
  id:               string;
  email:            string;
  name:             string;
  passwordHash:     string;
  plan:             PlanName;
  credits:          number;
  dailyCreditsUsed: number;
  dailyResetAt:     number;   // epoch ms: when to next refill
  lastRequestAt:    number;   // epoch ms: last successful agent call (throttle)
  createdAt:        number;
}

export interface UsageRecord {
  id:          string;
  userId:      string;
  tool:        string;
  provider:    string;
  creditsUsed: number;
  status:      'success' | 'failed' | 'blocked';
  prompt?:     string;
  durationMs?: number;
  timestamp:   number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function read<T>(file: string, fallback: T): T {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback;
  } catch { return fallback; }
}

function write(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Store API ─────────────────────────────────────────────────────────────────

export const store = {
  users: {
    all():                User[]          { return read<User[]>(USERS_FILE, []); },
    findByEmail(email: string)            { return this.all().find(u => u.email === email); },
    findById(id: string)                  { return this.all().find(u => u.id === id); },

    create(user: User): User {
      const users = this.all();
      if (users.some(u => u.email === user.email)) throw new Error('Email already registered');
      users.push(user);
      write(USERS_FILE, users);
      return user;
    },

    update(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): User {
      const users = this.all();
      const i = users.findIndex(u => u.id === id);
      if (i === -1) throw new Error(`User ${id} not found`);
      users[i] = { ...users[i], ...patch };
      write(USERS_FILE, users);
      return users[i];
    },
  },

  usage: {
    all():                    UsageRecord[] { return read<UsageRecord[]>(USAGE_FILE, []); },

    add(r: UsageRecord): void {
      const records = this.all();
      records.push(r);
      write(USAGE_FILE, records.slice(-100_000));  // cap at 100 k rows
    },

    forUser(userId: string, limit = 100): UsageRecord[] {
      return this.all()
        .filter(r => r.userId === userId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    },

    countTodayForUser(userId: string): number {
      const cutoff = Date.now() - 86_400_000;
      return this.all().filter(r => r.userId === userId && r.timestamp > cutoff).length;
    },

    statsByUser(userId: string) {
      const all = this.all().filter(r => r.userId === userId);
      const day  = Date.now() - 86_400_000;
      const week = Date.now() - 7 * 86_400_000;
      return {
        total:     all.length,
        today:     all.filter(r => r.timestamp > day).length,
        thisWeek:  all.filter(r => r.timestamp > week).length,
        credits:   all.reduce((s, r) => s + r.creditsUsed, 0),
        byTool:    all.reduce((m: Record<string, number>, r) => { m[r.tool] = (m[r.tool] ?? 0) + 1; return m; }, {} as Record<string, number>),
      };
    },
  },
};
