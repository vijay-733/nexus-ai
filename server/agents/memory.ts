// Short-term per-user conversation memory.
// Stored in-process (Map). Evicted after 30 min of idle activity.
// To make persistent: swap push/get/clear for store.memory table calls.

const TTL_MS    = 30 * 60_000;  // evict slot after 30 min idle
const MAX_TURNS = 10;            // max entries per user (= 5 full exchanges)

export interface MemoryEntry {
  role:      'user' | 'assistant';
  content:   string;
  tool:      string;
  timestamp: number;
}

interface Slot {
  entries:      MemoryEntry[];
  lastActiveAt: number;
}

const _mem = new Map<string, Slot>();

// Background pruning — avoids unbounded Map growth on long-running servers
setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [uid, slot] of _mem) {
    if (slot.lastActiveAt < cutoff) _mem.delete(uid);
  }
}, 5 * 60_000).unref();   // .unref() so this timer never prevents process exit

export const agentMemory = {
  push(userId: string, entry: MemoryEntry): void {
    const slot = _mem.get(userId) ?? { entries: [], lastActiveAt: 0 };
    slot.entries.push(entry);
    if (slot.entries.length > MAX_TURNS) slot.entries = slot.entries.slice(-MAX_TURNS);
    slot.lastActiveAt = Date.now();
    _mem.set(userId, slot);
  },

  get(userId: string): MemoryEntry[] {
    const slot = _mem.get(userId);
    if (!slot) return [];
    slot.lastActiveAt = Date.now();
    return [...slot.entries];
  },

  clear(userId: string): void {
    _mem.delete(userId);
  },

  size(userId: string): number {
    return _mem.get(userId)?.entries.length ?? 0;
  },
};
