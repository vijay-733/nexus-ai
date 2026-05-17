import Redis from 'ioredis';
import { globalEventBus } from './eventBus.js';
import type { AgentEvent, EventType } from './eventTypes.js';
import { logger } from '../utils/logger.js';

const CHANNEL = 'nexus:events';

// RedisEventBridge: bridges the in-process globalEventBus with Redis pub/sub.
// All events emitted locally are published to Redis so other instances receive them.
// Incoming Redis messages are injected into the local bus (with dedup guard).
export class RedisEventBridge {
  private pub:     Redis;
  private sub:     Redis;
  private ready    = false;
  private nodeId   = `node-${Math.random().toString(36).slice(2, 8)}`;

  constructor(redisUrl?: string) {
    const url  = redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.pub   = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.sub   = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async connect(): Promise<void> {
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    this.ready = true;

    // Subscribe to shared event channel
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_channel, message) => {
      try {
        const envelope: { nodeId: string; event: AgentEvent } = JSON.parse(message);
        // Skip events we published (already in local bus)
        if (envelope.nodeId === this.nodeId) return;
        globalEventBus.emit(envelope.event);
      } catch {
        // Malformed message — ignore
      }
    });

    // Forward all local events to Redis
    globalEventBus.onAny((event) => {
      if (!this.ready) return;
      const envelope = { nodeId: this.nodeId, event };
      this.pub.publish(CHANNEL, JSON.stringify(envelope)).catch(() => {
        // Fire-and-forget; fallback to local-only if Redis is down
      });
    });

    logger.info('redis-bus', `Connected node=${this.nodeId} channel=${CHANNEL}`);
  }

  async disconnect(): Promise<void> {
    this.ready = false;
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }

  // Publish a typed event directly (bypasses local bus dedup)
  async publish<P>(type: EventType, source: string, payload: P): Promise<void> {
    if (!this.ready) return;
    const { createEvent } = await import('./eventTypes.js');
    const event = createEvent(type, source, payload);
    globalEventBus.emit(event);
  }

  isReady(): boolean { return this.ready; }
}

// Singleton — null if Redis is not configured
let bridge: RedisEventBridge | null = null;

export async function initRedisEventBus(): Promise<RedisEventBridge | null> {
  if (!process.env.REDIS_URL) {
    logger.info('redis-bus', 'REDIS_URL not set — using local event bus only');
    return null;
  }
  try {
    bridge = new RedisEventBridge();
    await bridge.connect();
    return bridge;
  } catch (err) {
    logger.warn('redis-bus', `Connection failed: ${err instanceof Error ? err.message : err} — local bus only`);
    return null;
  }
}

export function getRedisEventBridge(): RedisEventBridge | null { return bridge; }
