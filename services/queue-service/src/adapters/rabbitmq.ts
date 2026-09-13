/**
 * RabbitMQ adapter — on-premise alternative to AWS SQS.
 *
 * Implements the same Queue interface (publish/subscribe/start/stop) so all 33
 * services work identically whether backed by SQS (cloud) or RabbitMQ (on-prem).
 *
 * Topology:
 *   - Each topic → a fanout exchange (mirrors SQS fan-out behaviour)
 *   - Each service+topic → a durable queue bound to the exchange
 *   - DLQ: a separate exchange + queue per service+topic (dead-letter-exchange)
 *   - PERF-017: retry backoff — a small set of per-delay "parking lot" queues
 *     per service+topic (one per distinct backoff bucket, e.g. `.retry.1s`,
 *     `.retry.2s`, `.retry.4s`, ...). A failed-but-retryable message is acked
 *     off the main queue and republished into the bucket queue matching its
 *     backoff delay; that queue has `x-message-ttl` set to the delay and its
 *     dead-letter-exchange is the *default* exchange with routing key = the
 *     main queue's own name, so on TTL expiry RabbitMQ redelivers it straight
 *     back to just that one queue (not back through the topic's fanout
 *     exchange, which would re-fan the retry out to every other service
 *     subscribed to the same topic). See requeueWithBackoff().
 *
 * Env vars:
 *   RABBITMQ_URL                   — amqp://user:pass@host:5672 (default: amqp://localhost)
 *   RABBITMQ_PREFETCH              — consumer prefetch count (default: 10)
 *   RABBITMQ_MAX_RETRIES           — max delivery attempts before DLQ (default: 5)
 *   RABBITMQ_BACKOFF_BASE_SECONDS  — PERF-017 retry backoff base (default: 1)
 *   RABBITMQ_BACKOFF_MAX_SECONDS   — PERF-017 retry backoff cap (default: 60)
 */
import { connect, type ChannelModel, type Channel, type ConsumeMessage } from "amqplib";
import { parseEnvelope } from "@civitasone/events";
import { incrementConsumerError, incrementDlqMessage, captureError, recordConsumerHeartbeat } from "@civitasone/observability";
import type { Queue, QueueDriver, CommandEnvelope, PublishInput, Handler, PublishOptions, SubscribeOptions } from "../bus.js";
import {
  NonRetryableError,
  isFifoTopic,
  computeBackoffSeconds,
  DEFAULT_SQS_BACKOFF_BASE_SECONDS,
  DEFAULT_SQS_BACKOFF_MAX_SECONDS,
} from "../bus.js";
import { randomUUID } from "node:crypto";

/**
 * PERF-017: RabbitMQ has no ChangeMessageVisibility equivalent, so the SQS
 * backoff *curve* (computeBackoffSeconds, imported above — base 1s, factor 2,
 * capped 60s per skill 07) is reused as-is; only the env-var names differ,
 * matching this adapter's existing RABBITMQ_* convention rather than SQS_*.
 */
export function resolveRabbitBackoffBaseSeconds(
  raw: string | undefined = process.env.RABBITMQ_BACKOFF_BASE_SECONDS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SQS_BACKOFF_BASE_SECONDS;
  return Math.floor(parsed);
}

export function resolveRabbitBackoffMaxSeconds(
  raw: string | undefined = process.env.RABBITMQ_BACKOFF_MAX_SECONDS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SQS_BACKOFF_MAX_SECONDS;
  return Math.floor(parsed);
}

export class RabbitMqQueue implements Queue {
  private connection: ChannelModel | null = null;
  private publishChannel: Channel | null = null;
  private consumeChannel: Channel | null = null;
  private handlers = new Map<string, Handler[]>();
  private readonly url: string;
  private readonly prefetch: number;
  private readonly maxRetries: number;
  private readonly backoffBaseSeconds: number;
  private readonly backoffMaxSeconds: number;
  private readonly service: string;
  private started = false;

  constructor() {
    this.url = process.env.RABBITMQ_URL ?? "amqp://localhost";
    this.prefetch = Number(process.env.RABBITMQ_PREFETCH ?? 10);
    this.maxRetries = Number(process.env.RABBITMQ_MAX_RETRIES ?? 5);
    this.backoffBaseSeconds = resolveRabbitBackoffBaseSeconds();
    this.backoffMaxSeconds = resolveRabbitBackoffMaxSeconds();

    // Derive service name (same logic as SqsQueue)
    const fromPath = (p: string | undefined): string | undefined => {
      const m = (p ?? "").match(/[/\\]services[/\\]([^/\\]+)[/\\]/);
      return m ? m[1] : undefined;
    };
    this.service = process.env.SERVICE_NAME
      ?? fromPath(process.env.pm_exec_path)
      ?? fromPath(process.argv[1])
      ?? process.env.name
      ?? process.env.npm_package_name
      ?? "queue-service";
  }

  subscribe<T>(topic: string, handler: Handler<T>, _options?: SubscribeOptions): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as Handler);
    this.handlers.set(topic, list);
  }

  async publish<T>(topic: string, input: PublishInput<T>, _options?: PublishOptions): Promise<string> {
    const msg = this.envelope(input);
    const ch = await this.getPublishChannel();
    const exchange = this.exchangeName(topic);

    // Ensure exchange exists (idempotent)
    await ch.assertExchange(exchange, "fanout", { durable: true });

    ch.publish(exchange, "", Buffer.from(JSON.stringify(msg)), {
      persistent: true,
      messageId: msg.messageId,
      correlationId: msg.correlationId,
      headers: { type: msg.type, tenantId: msg.tenantId },
    });

    return msg.messageId;
  }

  async start(): Promise<void> {
    this.started = true;
    const ch = await this.getConsumeChannel();
    await ch.prefetch(this.prefetch);

    for (const [topic, handlers] of this.handlers.entries()) {
      const exchange = this.exchangeName(topic);
      const queueName = this.queueName(topic);
      const dlxExchange = `${exchange}.dlx`;
      const dlqName = `${queueName}.dlq`;

      // DLX + DLQ setup
      await ch.assertExchange(dlxExchange, "fanout", { durable: true });
      await ch.assertQueue(dlqName, { durable: true });
      await ch.bindQueue(dlqName, dlxExchange, "");

      // Main exchange + queue
      await ch.assertExchange(exchange, "fanout", { durable: true });
      await ch.assertQueue(queueName, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": dlxExchange,
          "x-dead-letter-routing-key": "",
        },
      });
      await ch.bindQueue(queueName, exchange, "");

      // PERF-017: one "parking lot" queue per distinct backoff bucket this
      // adapter can produce for `queueName` (bounded by maxRetries — see
      // backoffBucketSeconds()). No binding needed: messages are published
      // directly to each retry queue by name via the default exchange
      // (sendToQueue), and on TTL expiry each redirects — via its own
      // dead-letter-exchange="" + dead-letter-routing-key=queueName — straight
      // back to this same main queue, never through the fanout exchange.
      for (const seconds of this.backoffBucketSeconds()) {
        await ch.assertQueue(this.retryQueueName(queueName, seconds), {
          durable: true,
          arguments: {
            "x-message-ttl": seconds * 1000,
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": queueName,
          },
        });
      }

      // Consume
      await ch.consume(queueName, async (sqsMsg: ConsumeMessage | null) => {
        if (!sqsMsg) return;

        recordConsumerHeartbeat(this.service);

        let msg: CommandEnvelope;
        try {
          msg = JSON.parse(sqsMsg.content.toString()) as CommandEnvelope;
        } catch {
          // Unparseable → DLQ
          ch.nack(sqsMsg, false, false);
          incrementDlqMessage(topic, "unparseable_body");
          return;
        }

        // Envelope validation
        const parsed = parseEnvelope(msg);
        if (!parsed.ok) {
          incrementConsumerError(this.service, topic);
          captureError(new Error(`invalid_envelope: ${parsed.error}`), {
            service: this.service, topic, messageId: msg.messageId,
          });
          ch.nack(sqsMsg, false, false); // → DLX
          incrementDlqMessage(topic, "invalid_envelope");
          return;
        }

        const deliveryCount = (sqsMsg.properties.headers?.["x-delivery-count"] as number | undefined) ?? 1;

        let allHandled = true;
        for (const h of handlers) {
          try {
            await h(msg);
          } catch (err) {
            if (err instanceof NonRetryableError) {
              incrementConsumerError(this.service, topic);
              captureError(err, { service: this.service, topic, messageId: msg.messageId });
              ch.nack(sqsMsg, false, false); // → DLX immediately
              incrementDlqMessage(topic, "non_retryable_error");
              return;
            }
            allHandled = false;
            incrementConsumerError(this.service, topic);
            captureError(err, { service: this.service, topic, messageId: msg.messageId, deliveryCount });
            this.logError(topic, msg, deliveryCount, err);
          }
        }

        if (allHandled) {
          ch.ack(sqsMsg);
        } else if (deliveryCount >= this.maxRetries) {
          // Max retries exceeded → DLQ
          ch.nack(sqsMsg, false, false);
          incrementDlqMessage(topic, "max_retries_exceeded");
        } else {
          // PERF-017: back off instead of an immediate fixed-rate requeue.
          // Ack the delivery off the main queue (we're taking ownership of
          // redelivery ourselves) and republish into the bucket queue for
          // this attempt's backoff delay; that queue's TTL+DLX combo returns
          // it to this exact queue once the delay elapses. Best-effort: if
          // the republish itself throws, nack-requeue so the message still
          // redelivers (immediately, at the old fixed rate) rather than being
          // lost — never let backoff-plumbing failure break at-least-once.
          try {
            await this.requeueWithBackoff(ch, sqsMsg, queueName, deliveryCount);
            ch.ack(sqsMsg);
          } catch (err) {
            this.logError(topic, msg, deliveryCount, err);
            ch.nack(sqsMsg, false, true);
          }
        }
      });
    }

    process.stdout.write(
      JSON.stringify({
        level: "info",
        msg: "rabbitmq-queue started",
        service: this.service,
        topics: [...this.handlers.keys()],
        url: this.url.replace(/:[^:@]+@/, ":***@"), // mask password
      }) + "\n",
    );
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.consumeChannel) {
      await this.consumeChannel.close().catch(() => {});
      this.consumeChannel = null;
    }
    if (this.publishChannel) {
      await this.publishChannel.close().catch(() => {});
      this.publishChannel = null;
    }
    if (this.connection) {
      await this.connection.close().catch(() => {});
      this.connection = null;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }> {
    try {
      const conn = await this.getConnection();
      return { healthy: conn !== null, driver: "rabbitmq" as QueueDriver };
    } catch {
      return { healthy: false, driver: "rabbitmq" as QueueDriver };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async getConnection(): Promise<ChannelModel> {
    if (!this.connection) {
      this.connection = await connect(this.url);
      this.connection.on("close", () => { this.connection = null; this.publishChannel = null; this.consumeChannel = null; });
      this.connection.on("error", (err) => {
        // eslint-disable-next-line no-console -- structured operational error log
        console.error(JSON.stringify({ level: "error", event: "rabbitmq_connection_error", service: this.service, err: String(err) }));
      });
    }
    return this.connection;
  }

  private async getPublishChannel(): Promise<Channel> {
    if (!this.publishChannel) {
      const conn = await this.getConnection();
      this.publishChannel = await conn.createChannel();
    }
    return this.publishChannel;
  }

  private async getConsumeChannel(): Promise<Channel> {
    if (!this.consumeChannel) {
      const conn = await this.getConnection();
      this.consumeChannel = await conn.createChannel();
    }
    return this.consumeChannel;
  }

  private exchangeName(topic: string): string {
    // Use dots as exchange names (natural RabbitMQ convention)
    return topic;
  }

  private queueName(topic: string): string {
    // Per-service queue (same fan-out model as SQS adapter)
    const base = topic.replace(/\./g, "-");
    return `${base}__${this.service}`;
  }

  /**
   * PERF-017: the distinct backoff delays (seconds) this adapter can produce
   * for attempts 1..maxRetries-1 — the last attempt (maxRetries) always goes
   * straight to the DLQ, never through a retry queue, so it's excluded here.
   * Bounded (5 buckets by default) and fully determined by the constructor's
   * fixed base/max/maxRetries, so it's safe to declare once at start() and
   * never recompute per-message.
   */
  private backoffBucketSeconds(): number[] {
    const seconds = new Set<number>();
    for (let attempt = 1; attempt < this.maxRetries; attempt++) {
      seconds.add(computeBackoffSeconds(attempt, {
        baseSeconds: this.backoffBaseSeconds,
        maxSeconds: this.backoffMaxSeconds,
      }));
    }
    return [...seconds];
  }

  private retryQueueName(queueName: string, seconds: number): string {
    return `${queueName}.retry.${seconds}s`;
  }

  /**
   * PERF-017: republish `sqsMsg` into the parking-lot queue matching the
   * backoff delay for `deliveryCount` (the attempt that just failed), tagging
   * it with the next attempt's delivery count. Preserves the original
   * envelope bytes/messageId/correlationId untouched — only the "x-delivery-
   * count" header changes — so retries stay indistinguishable from the
   * original message to everything except this adapter's own retry-counting.
   *
   * Unlike SQS's ApproximateReceiveCount (maintained by the broker), classic
   * RabbitMQ queues do not track a delivery count on plain nack-requeue, so
   * this adapter must stamp and propagate it itself on every hop.
   */
  private async requeueWithBackoff(
    ch: Channel,
    sqsMsg: ConsumeMessage,
    queueName: string,
    deliveryCount: number,
  ): Promise<void> {
    const delaySeconds = computeBackoffSeconds(deliveryCount, {
      baseSeconds: this.backoffBaseSeconds,
      maxSeconds: this.backoffMaxSeconds,
    });
    const retryQueue = this.retryQueueName(queueName, delaySeconds);
    const ok = ch.sendToQueue(retryQueue, sqsMsg.content, {
      persistent: true,
      messageId: sqsMsg.properties.messageId,
      correlationId: sqsMsg.properties.correlationId,
      headers: {
        ...(sqsMsg.properties.headers ?? {}),
        "x-delivery-count": deliveryCount + 1,
      },
    });
    if (!ok) {
      // amqplib backpressure signal (write buffer full) — treat as failure so
      // the caller's catch falls back to an immediate nack-requeue rather
      // than silently dropping the message.
      throw new Error(`sendToQueue backpressure on ${retryQueue}`);
    }
  }

  private envelope<T>(input: PublishInput<T>): CommandEnvelope<T> {
    return {
      messageId: input.messageId ?? randomUUID(),
      type: input.type,
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      ...(input.causationId ? { causationId: input.causationId } : {}),
      timestamp: input.timestamp ?? new Date().toISOString(),
      schemaVersion: input.schemaVersion,
      payload: input.payload,
    };
  }

  private logError(topic: string, msg: CommandEnvelope | null, deliveryCount: number, err: unknown): void {
    // eslint-disable-next-line no-console -- structured operational error log
    console.error(JSON.stringify({
      level: "error",
      event: "queue_consumer_error",
      service: this.service,
      topic,
      messageId: msg?.messageId,
      correlationId: msg?.correlationId,
      deliveryCount,
      err: err instanceof Error ? err.stack : String(err),
    }));
  }
}

// ── Legacy QueueClient shim (for createRabbitMqClient compatibility) ──────
import type { QueueClient } from "../types.js";
import { createMemoryClient } from "./memory.js";

export function createRabbitMqClient(): QueueClient {
  if (process.env.NODE_ENV === "production") {
    // The QueueClient interface is only used by queue-service's HTTP API.
    // Domain services use the Queue interface (bus.ts) directly.
    // For production, use QUEUE_DRIVER=rabbitmq in bus.ts.
    throw new Error(
      "Use QUEUE_DRIVER=rabbitmq in production — the QueueClient shim is for dev/test only.",
    );
  }
  return createMemoryClient();
}
