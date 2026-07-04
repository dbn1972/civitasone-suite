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
 *
 * Env vars:
 *   RABBITMQ_URL          — amqp://user:pass@host:5672 (default: amqp://localhost)
 *   RABBITMQ_PREFETCH     — consumer prefetch count (default: 10)
 *   RABBITMQ_MAX_RETRIES  — max delivery attempts before DLQ (default: 5)
 */
import { connect, type ChannelModel, type Channel, type ConsumeMessage } from "amqplib";
import { parseEnvelope } from "@civitasone/events";
import { incrementConsumerError, incrementDlqMessage, captureError, recordConsumerHeartbeat } from "@civitasone/observability";
import type { Queue, QueueDriver, CommandEnvelope, PublishInput, Handler, PublishOptions } from "../bus.js";
import { NonRetryableError, isFifoTopic } from "../bus.js";
import { randomUUID } from "node:crypto";

export class RabbitMqQueue implements Queue {
  private connection: ChannelModel | null = null;
  private publishChannel: Channel | null = null;
  private consumeChannel: Channel | null = null;
  private handlers = new Map<string, Handler[]>();
  private readonly url: string;
  private readonly prefetch: number;
  private readonly maxRetries: number;
  private readonly service: string;
  private started = false;

  constructor() {
    this.url = process.env.RABBITMQ_URL ?? "amqp://localhost";
    this.prefetch = Number(process.env.RABBITMQ_PREFETCH ?? 10);
    this.maxRetries = Number(process.env.RABBITMQ_MAX_RETRIES ?? 5);

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

  subscribe<T>(topic: string, handler: Handler<T>): void {
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
          incrementDlqMessage(topic);
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
          incrementDlqMessage(topic);
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
              incrementDlqMessage(topic);
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
          incrementDlqMessage(topic);
        } else {
          // Requeue for retry
          ch.nack(sqsMsg, false, true);
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
