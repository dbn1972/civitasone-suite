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
  ListQueuesCommand,
} from "@aws-sdk/client-sqs";

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
  private polling = false;
  private pollLoops: Promise<void>[] = [];

  constructor() {
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
    this.queueUrls.set(topic, url);
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
        }));

        for (const sqsMsg of res.Messages ?? []) {
          let msg: CommandEnvelope;
          try {
            msg = JSON.parse(sqsMsg.Body ?? "{}") as CommandEnvelope;
          } catch {
            await this.deleteSqsMessage(url, sqsMsg.ReceiptHandle!);
            continue;
          }

          let handled = true;
          for (const h of handlers) {
            try {
              await h(msg);
            } catch {
              handled = false;
            }
          }
          if (handled) {
            await this.deleteSqsMessage(url, sqsMsg.ReceiptHandle!);
          }
        }
      } catch {
        if (this.polling) await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async deleteSqsMessage(url: string, receiptHandle: string): Promise<void> {
    try {
      await this.client.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }));
    } catch { /* best-effort */ }
  }
}

/** Resolve driver from QUEUE_DRIVER (primary) or QUEUE_ADAPTER (legacy alias). */
export function resolveQueueDriver(): QueueDriver {
  const driver = process.env.QUEUE_DRIVER ?? process.env.QUEUE_ADAPTER ?? "memory";
  if (driver === "sqs") return "sqs";
  if (driver === "memory" || driver === "rabbitmq") return "memory";
  throw new Error(`Unknown queue driver "${driver}" — valid: memory, sqs`);
}

export function createQueue(): Queue {
  const driver = resolveQueueDriver();
  switch (driver) {
    case "memory": return new MemoryQueue();
    case "sqs":    return new SqsQueue();
    default:       throw new Error(`Unknown QUEUE_DRIVER: "${driver}"`);
  }
}
