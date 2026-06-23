/**
 * CivitasOne message bus — canonical implementation.
 * Domain services import via @civitasone/queue (facade) or @civitasone/queue-service directly.
 *
 * QUEUE_DRIVER=memory  — in-process (tests / local)
 * QUEUE_DRIVER=sqs     — AWS SQS / LocalStack
 */
import { randomUUID } from "node:crypto";
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  CreateQueueCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  ListQueuesCommand,
} from "@aws-sdk/client-sqs";
import { incrementConsumerError, incrementDlqMessage, captureError } from "@civitasone/observability";

export type CommandEnvelope<T = unknown> = {
  messageId: string;
  type: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  causationId?: string;
  timestamp: string;
  schemaVersion: string;
  payload: T;
};

export type PublishInput<T> = Omit<CommandEnvelope<T>, "messageId" | "timestamp"> & {
  messageId?: string;
  timestamp?: string;
};

export type Handler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;

export type QueueDriver = "memory" | "sqs";

export interface Queue {
  publish<T>(topic: string, input: PublishInput<T>): Promise<string>;
  subscribe<T>(topic: string, handler: Handler<T>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }>;
}

function envelope<T>(input: PublishInput<T>): CommandEnvelope<T> {
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

export class MemoryQueue implements Queue {
  private handlers = new Map<string, Handler[]>();
  private seen = new Set<string>();
  readonly dlq: Array<{ topic: string; msg: CommandEnvelope; error: string }> = [];
  private maxAttempts: number;

  constructor(opts: { maxAttempts?: number } = {}) {
    this.maxAttempts = opts.maxAttempts ?? 5;
  }

  async publish<T>(topic: string, input: PublishInput<T>): Promise<string> {
    const msg = envelope(input);
    const handlers = this.handlers.get(topic) ?? [];
    setTimeout(() => {
      for (const h of handlers) void this.deliver(topic, h, msg);
    }, 0);
    return msg.messageId;
  }

  subscribe<T>(topic: string, handler: Handler<T>): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as Handler);
    this.handlers.set(topic, list);
  }

  async start(): Promise<void> { /* push-based */ }
  async stop(): Promise<void> { this.handlers.clear(); }

  async healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }> {
    return { healthy: true, driver: "memory" };
  }

  private async deliver(topic: string, handler: Handler, msg: CommandEnvelope): Promise<void> {
    const key = `${topic}:${msg.messageId}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await handler(msg);
        return;
      } catch (err) {
        if (attempt === this.maxAttempts) {
          this.seen.delete(key);
          this.dlq.push({ topic, msg, error: err instanceof Error ? err.message : String(err) });
          return;
        }
        await new Promise((r) => setTimeout(r, 2 ** attempt * 10));
      }
    }
  }
}

function topicToQueueName(topic: string): string {
  return topic.replace(/\./g, "-").slice(0, 80);
}

export class SqsQueue implements Queue {
  private client: SQSClient;
  private handlers = new Map<string, Handler[]>();
  private queueUrls = new Map<string, string>();
  private dlqUrls = new Map<string, string>();
  private polling = false;
  private pollLoops: Promise<void>[] = [];
  private readonly service: string;
  private readonly maxReceiveCount: number;
  private readonly visibilityTimeout: number;

  constructor() {
    this.service = process.env.SERVICE_NAME ?? process.env.npm_package_name ?? "queue-service";
    this.maxReceiveCount = Number(process.env.SQS_MAX_RECEIVE_COUNT ?? 5);
    this.visibilityTimeout = Number(process.env.SQS_VISIBILITY_TIMEOUT ?? 60);
    this.client = new SQSClient({
      region: process.env.AWS_DEFAULT_REGION ?? "ap-south-1",
      ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL } : {}),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
      },
    });
  }

  private async getOrCreateQueue(topic: string): Promise<string> {
    const cached = this.queueUrls.get(topic);
    if (cached) return cached;
    const name = topicToQueueName(topic);
    await this.client.send(new CreateQueueCommand({ QueueName: name }));
    const res = await this.client.send(new GetQueueUrlCommand({ QueueName: name }));
    const url = res.QueueUrl!;
    // QUE-2: attach a native SQS RedrivePolicy (DLQ + maxReceiveCount) and a
    // tuned visibility timeout so the broker itself dead-letters poison messages.
    // Idempotent: SetQueueAttributes is safe to re-apply on every cold start.
    try {
      const dlqUrl = await this.getOrCreateDlq(topic);
      const dlqAttrs = await this.client.send(
        new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ["QueueArn"] }),
      );
      const dlqArn = dlqAttrs.Attributes?.QueueArn;
      if (dlqArn) {
        await this.client.send(new SetQueueAttributesCommand({
          QueueUrl: url,
          Attributes: {
            RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: this.maxReceiveCount }),
            VisibilityTimeout: String(this.visibilityTimeout),
          },
        }));
      }
    } catch (err) {
      // Non-fatal: the app-level safety net in pollTopic still dead-letters.
      this.logHandlerError(topic, null, 0, err);
    }
    this.queueUrls.set(topic, url);
    return url;
  }

  /** Resolve (creating if needed) the dead-letter queue URL for a topic. */
  private async getOrCreateDlq(topic: string): Promise<string> {
    const cached = this.dlqUrls.get(topic);
    if (cached) return cached;
    const name = `${topicToQueueName(topic).slice(0, 76)}-dlq`;
    await this.client.send(new CreateQueueCommand({ QueueName: name }));
    const res = await this.client.send(new GetQueueUrlCommand({ QueueName: name }));
    const url = res.QueueUrl!;
    this.dlqUrls.set(topic, url);
    return url;
  }

  async publish<T>(topic: string, input: PublishInput<T>): Promise<string> {
    const msg = envelope(input);
    const url = await this.getOrCreateQueue(topic);
    await this.client.send(new SendMessageCommand({
      QueueUrl: url,
      MessageBody: JSON.stringify(msg),
      MessageAttributes: {
        messageId:     { DataType: "String", StringValue: msg.messageId },
        correlationId: { DataType: "String", StringValue: msg.correlationId },
        type:          { DataType: "String", StringValue: msg.type },
      },
    }));
    return msg.messageId;
  }

  subscribe<T>(topic: string, handler: Handler<T>): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as Handler);
    this.handlers.set(topic, list);
  }

  async start(): Promise<void> {
    this.polling = true;
    for (const topic of this.handlers.keys()) {
      this.pollLoops.push(this.pollTopic(topic));
    }
  }

  async stop(): Promise<void> {
    this.polling = false;
    await Promise.allSettled(this.pollLoops);
  }

  async healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }> {
    try {
      await this.client.send(new ListQueuesCommand({ MaxResults: 1 }));
      return { healthy: true, driver: "sqs" };
    } catch {
      return { healthy: false, driver: "sqs" };
    }
  }

  private async pollTopic(topic: string): Promise<void> {
    const url = await this.getOrCreateQueue(topic);
    const handlers = this.handlers.get(topic) ?? [];

    while (this.polling) {
      try {
        const res = await this.client.send(new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ["All"],
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }));

        for (const sqsMsg of res.Messages ?? []) {
          let msg: CommandEnvelope;
          try {
            msg = JSON.parse(sqsMsg.Body ?? "{}") as CommandEnvelope;
          } catch {
            // Unparseable poison message — dead-letter immediately, never loop.
            await this.routeToDlq(topic, sqsMsg.Body ?? "", "unparseable_body");
            await this.deleteSqsMessage(url, sqsMsg.ReceiptHandle!);
            continue;
          }

          const receiveCount = Number(sqsMsg.Attributes?.ApproximateReceiveCount ?? "1");

          // QUE-1: per-message handling. A failure in one handler is logged +
          // counted and leaves the message for redelivery; it does NOT silently
          // vanish. Success of all handlers is required before delete.
          let allHandled = true;
          for (const h of handlers) {
            try {
              await h(msg);
            } catch (err) {
              allHandled = false;
              incrementConsumerError(this.service, topic);
              captureError(err, { service: this.service, topic, messageId: msg.messageId, correlationId: msg.correlationId, receiveCount });
              this.logHandlerError(topic, msg, receiveCount, err);
            }
          }

          if (allHandled) {
            await this.deleteSqsMessage(url, sqsMsg.ReceiptHandle!);
            continue;
          }

          // QUE-1: after maxReceiveCount receives, route to the topic DLQ so the
          // message stops looping invisibly. (Native SQS RedrivePolicy also does
          // this; this is the app-level safety net for parity in LocalStack.)
          if (receiveCount >= this.maxReceiveCount) {
            await this.routeToDlq(topic, sqsMsg.Body ?? "", "max_receive_count_exceeded");
            await this.deleteSqsMessage(url, sqsMsg.ReceiptHandle!);
          }
          // else: leave the message; visibility timeout will redeliver it.
        }
      } catch (err) {
        if (this.polling) {
          incrementConsumerError(this.service, topic);
          this.logHandlerError(topic, null, 0, err);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }

  private logHandlerError(
    topic: string,
    msg: CommandEnvelope | null,
    receiveCount: number,
    err: unknown,
  ): void {
    const stack = err instanceof Error ? err.stack : String(err);
    // Structured single-line log so it is greppable + parseable by log shippers.
    console.error(
      JSON.stringify({
        level: "error",
        event: "queue_consumer_error",
        service: this.service,
        topic,
        messageId: msg?.messageId,
        correlationId: msg?.correlationId,
        receiveCount,
        err: stack,
      }),
    );
  }

  private async routeToDlq(topic: string, body: string, reason: string): Promise<void> {
    try {
      const dlqUrl = await this.getOrCreateDlq(topic);
      await this.client.send(new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: body,
        MessageAttributes: {
          dlqReason: { DataType: "String", StringValue: reason },
          originTopic: { DataType: "String", StringValue: topic },
        },
      }));
      // OPS-1: DLQ routing is now observable (metric + structured log).
      incrementDlqMessage(topic);
      console.error(
        JSON.stringify({ level: "error", event: "queue_message_dead_lettered", service: this.service, topic, reason }),
      );
    } catch (err) {
      this.logHandlerError(topic, null, 0, err);
    }
  }

  private async deleteSqsMessage(url: string, receiptHandle: string): Promise<void> {
    try {
      await this.client.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }));
    } catch { /* best-effort */ }
  }
}

/**
 * Resolve driver from QUEUE_DRIVER (primary) or QUEUE_ADAPTER (legacy alias).
 *
 * QUE-3 (05-T3): fail closed. The driver must be set explicitly outside tests;
 * an unset or unknown value is fatal rather than silently falling back to the
 * in-memory queue (which drops messages on restart). The old `rabbitmq → memory`
 * alias is removed — an unsupported driver is a hard error.
 */
export function resolveQueueDriver(): QueueDriver {
  const raw = process.env.QUEUE_DRIVER ?? process.env.QUEUE_ADAPTER;
  const isTest =
    process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

  if (raw === undefined || raw === "") {
    if (isTest) return "memory";
    throw new Error(
      "FATAL: QUEUE_DRIVER is required outside test environments. " +
        "Set QUEUE_DRIVER=sqs (production) or QUEUE_DRIVER=memory (explicit local dev).",
    );
  }
  if (raw === "sqs") return "sqs";
  if (raw === "memory") return "memory";
  throw new Error(`FATAL: unknown QUEUE_DRIVER "${raw}" — valid values: memory, sqs`);
}

export function createQueue(): Queue {
  const driver = resolveQueueDriver();
  if (driver === "memory" && process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: QUEUE_DRIVER=memory is forbidden in production. Set QUEUE_DRIVER=sqs and configure AWS/SQS.",
    );
  }
  switch (driver) {
    case "memory": return new MemoryQueue();
    case "sqs":    return new SqsQueue();
    default:       throw new Error(`Unknown QUEUE_DRIVER: "${driver}"`);
  }
}
