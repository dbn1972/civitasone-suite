import { Redis } from "ioredis";
import { pino } from "pino";

const log = pino({ name: "notification:pubsub" });

export interface NotificationPublisher {
  publish(channel: string, payload: Record<string, unknown>): Promise<void>;
}

/** In-process pub/sub for tests and local dev without Redis. */
export class MemoryNotificationPublisher implements NotificationPublisher {
  readonly messages = new Map<string, string[]>();

  async publish(channel: string, payload: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify(payload);
    const list = this.messages.get(channel) ?? [];
    list.push(body);
    this.messages.set(channel, list);
  }
}

class RedisNotificationPublisher implements NotificationPublisher {
  constructor(private redis: Redis) {}

  async publish(channel: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(payload));
  }
}

let testPublisher: NotificationPublisher | null = null;

/** Process-wide Redis publisher, reused across calls (one connection, not one per call). */
let redisPublisher: { url: string; publisher: NotificationPublisher } | null = null;

/** Override publisher in tests. Pass `null` to reset. */
export function setNotificationPublisherForTests(publisher: NotificationPublisher | null): void {
  testPublisher = publisher;
  if (publisher === null) redisPublisher = null;
}

export function createNotificationPublisher(): NotificationPublisher {
  if (testPublisher) return testPublisher;

  const driver = process.env.NOTIFICATION_IN_APP_DRIVER ?? (process.env.REDIS_URL ? "redis" : "memory");
  if (driver === "memory") return new MemoryNotificationPublisher();

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("in_app not configured: set REDIS_URL or NOTIFICATION_IN_APP_DRIVER=memory");
  }
  if (redisPublisher && redisPublisher.url === url) return redisPublisher.publisher;

  const client = new Redis(url);
  client.on("error", (err: Error) => {
    log.warn({ err }, "notification pubsub redis connection error");
  });
  const publisher = new RedisNotificationPublisher(client);
  redisPublisher = { url, publisher };
  return publisher;
}
