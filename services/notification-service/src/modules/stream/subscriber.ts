import { Redis } from "ioredis";
import { pino } from "pino";

const log = pino({ name: "stream:subscriber" });

export interface StreamSubscriber {
  unsubscribe(): Promise<void>;
}

type MessageHandler = (message: string) => void;

/**
 * In-memory subscriber for tests and local dev without Redis.
 * Uses a simple event emitter pattern.
 */
class MemoryStreamSubscriber implements StreamSubscriber {
  constructor(
    private channel: string,
    private handler: MessageHandler,
  ) {
    memorySubscribers.add(this);
  }

  /** Deliver a message to this subscriber (called by publish in memory mode) */
  deliver(message: string): void {
    this.handler(message);
  }

  getChannel(): string {
    return this.channel;
  }

  async unsubscribe(): Promise<void> {
    memorySubscribers.delete(this);
  }
}

/** Global registry of memory subscribers for testing */
const memorySubscribers = new Set<MemoryStreamSubscriber>();

/** Publish to all in-memory subscribers on the given channel (used in tests) */
export function publishToMemorySubscribers(channel: string, message: string): void {
  for (const sub of memorySubscribers) {
    if (sub.getChannel() === channel) {
      sub.deliver(message);
    }
  }
}

/** Clear all memory subscribers (test cleanup) */
export function clearMemorySubscribers(): void {
  memorySubscribers.clear();
}

/**
 * Redis-based subscriber using a dedicated connection for SUBSCRIBE.
 */
class RedisStreamSubscriber implements StreamSubscriber {
  private redis: Redis;

  constructor(
    private channel: string,
    private handler: MessageHandler,
    redisUrl: string,
  ) {
    // Create a dedicated Redis connection for subscribing
    // (Redis requires a separate connection for SUBSCRIBE mode)
    this.redis = new Redis(redisUrl, { lazyConnect: true });
    this.redis.on("error", (err) => {
      log.warn({ err, channel: this.channel }, "Redis subscriber connection error");
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
    await this.redis.subscribe(this.channel);
    this.redis.on("message", (ch: string, message: string) => {
      if (ch === this.channel) {
        this.handler(message);
      }
    });
    log.info({ channel: this.channel }, "Redis subscriber connected");
  }

  async unsubscribe(): Promise<void> {
    try {
      await this.redis.unsubscribe(this.channel);
      this.redis.disconnect();
    } catch (err) {
      log.warn({ err, channel: this.channel }, "Error during Redis unsubscribe");
    }
  }
}

/**
 * Create a stream subscriber for the given channel.
 * Uses Redis in production, in-memory for tests.
 */
export async function createStreamSubscriber(
  channel: string,
  handler: MessageHandler,
): Promise<StreamSubscriber> {
  const driver = process.env.NOTIFICATION_IN_APP_DRIVER ?? (process.env.REDIS_URL ? "redis" : "memory");

  if (driver === "memory") {
    return new MemoryStreamSubscriber(channel, handler);
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.warn("REDIS_URL not configured, falling back to memory subscriber");
    return new MemoryStreamSubscriber(channel, handler);
  }

  const subscriber = new RedisStreamSubscriber(channel, handler, redisUrl);
  await subscriber.connect();
  return subscriber;
}
