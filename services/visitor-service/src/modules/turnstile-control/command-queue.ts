/**
 * visitor-service: turnstile-control — Redis-backed per-device command FIFO.
 *
 * Each device has a Redis LIST used as a FIFO queue for pending commands.
 * Commands are LPUSH'd (enqueue) and RPOP'd (dequeue) to guarantee order.
 * On dequeue, expired commands are skipped and discarded.
 *
 * Key pattern: `visitor:{tenantId}:device:{deviceId}:commands`
 *
 * Falls back to an in-memory Map for dev/test when Redis is unavailable.
 *
 * Requirements validated: 7.1, 7.9, 7.10
 */
import { Redis } from "ioredis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serialized command entry stored in the Redis LIST. */
export interface CommandEntry {
  id: string;
  commandType: string;
  payload: unknown;
  correlationId: string | null;
  expiresAt: string | null; // ISO datetime or null (no expiration)
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Redis Client
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return null;
  _redis = new Redis(url);
  return _redis;
}

/** Build the Redis key for a device's command queue. */
function queueKey(tenantId: string, deviceId: string): string {
  return `visitor:${tenantId}:device:${deviceId}:commands`;
}

// ---------------------------------------------------------------------------
// In-memory fallback for dev/tests
// ---------------------------------------------------------------------------

const _memoryQueues = new Map<string, string[]>();

function getMemoryQueue(key: string): string[] {
  let q = _memoryQueues.get(key);
  if (!q) {
    q = [];
    _memoryQueues.set(key, q);
  }
  return q;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a command to a device's command queue (LPUSH — tail of FIFO).
 * The command will be delivered when the device next polls.
 */
export async function enqueueCommand(
  tenantId: string,
  deviceId: string,
  command: CommandEntry,
): Promise<void> {
  const key = queueKey(tenantId, deviceId);
  const serialized = JSON.stringify(command);
  const redis = getRedis();

  if (redis) {
    await redis.lpush(key, serialized);
  } else {
    // In-memory: LPUSH equivalent (push to front, RPOP from end = FIFO)
    const q = getMemoryQueue(key);
    q.unshift(serialized);
  }
}

/**
 * Dequeue the next non-expired command from a device's queue (RPOP — head of FIFO).
 * Expired commands are silently discarded. Returns null if the queue is empty
 * or only contains expired commands.
 */
export async function dequeueCommand(
  tenantId: string,
  deviceId: string,
): Promise<CommandEntry | null> {
  const key = queueKey(tenantId, deviceId);
  const redis = getRedis();
  const now = new Date();

  // We may need to skip multiple expired commands
  const MAX_SKIP = 50; // Safety limit to avoid infinite loop
  for (let i = 0; i < MAX_SKIP; i++) {
    let raw: string | null = null;

    if (redis) {
      raw = await redis.rpop(key);
    } else {
      const q = getMemoryQueue(key);
      raw = q.length > 0 ? (q.pop() ?? null) : null;
    }

    if (!raw) return null;

    const entry: CommandEntry = JSON.parse(raw);

    // Check expiration — skip expired commands
    if (entry.expiresAt) {
      const expiresAt = new Date(entry.expiresAt);
      if (expiresAt <= now) {
        // Command expired — discard and try next
        continue;
      }
    }

    return entry;
  }

  return null;
}

/**
 * Get the number of commands currently in a device's queue.
 * Note: may include expired commands that haven't been dequeued yet.
 */
export async function getQueueLength(
  tenantId: string,
  deviceId: string,
): Promise<number> {
  const key = queueKey(tenantId, deviceId);
  const redis = getRedis();

  if (redis) {
    return redis.llen(key);
  }

  const q = _memoryQueues.get(key);
  return q ? q.length : 0;
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/**
 * Reset all in-memory queues. Only call from tests.
 */
export function resetCommandQueuesForTests(): void {
  _memoryQueues.clear();
  if (_redis) {
    _redis.disconnect();
    _redis = null;
  }
}
