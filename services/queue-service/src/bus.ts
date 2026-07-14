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
import { incrementConsumerError, incrementDlqMessage, captureError, recordConsumerHeartbeat } from "@civitasone/observability";
import { parseEnvelope } from "@civitasone/events";
import { withTenantConsumer } from "@civitasone/db";

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

import { RabbitMqQueue } from "./adapters/rabbitmq.js";

export type QueueDriver = "memory" | "sqs" | "rabbitmq";
/**
 * Throw this (or a subclass) from a consumer handler to bypass retry logic
 * and route the message directly to the DLQ. Use for permanent business
 * rejections (e.g. DUPLICATE_BID, BIDDING_CLOSED, entity not found) where
 * retrying will never succeed.
 */
export class NonRetryableError extends Error {
  readonly nonRetryable = true as const;
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** Type guard: true if the error is flagged as non-retryable. */
export function isNonRetryable(err: unknown): boolean {
  return (
    err instanceof NonRetryableError ||
    (err instanceof Error && (err as { nonRetryable?: unknown }).nonRetryable === true)
  );
}

/**
 * 05-T4: optional publish options. For order-sensitive topics (FIFO) the
 * broker needs a MessageGroupId (ordering scope) and a MessageDeduplicationId
 * (exactly-once within the dedup window). Defaults are derived from the
 * envelope (group = tenantId, dedup = messageId) when the topic name ends with
 * `.fifo`; callers may override either here.
 */
export type PublishOptions = {
  messageGroupId?: string;
  messageDeduplicationId?: string;
};

export interface Queue {
  publish<T>(topic: string, input: PublishInput<T>, options?: PublishOptions): Promise<string>;
  subscribe<T>(topic: string, handler: Handler<T>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }>;
}

/** 05-T4: a topic is order-sensitive (FIFO) when its name ends with `.fifo`. */
export function isFifoTopic(topic: string): boolean {
  return topic.endsWith(".fifo");
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

  async publish<T>(topic: string, input: PublishInput<T>, _options?: PublishOptions): Promise<string> {
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
    // 04-T3: validate the envelope before any handler runs. An invalid envelope
    // is rejected straight to the DLQ and handlers are never invoked.
    const parsed = parseEnvelope(msg);
    if (!parsed.ok) {
      this.dlq.push({ topic, msg, error: `invalid_envelope: ${parsed.error}` });
      return;
    }
    this.seen.add(key);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await handler(msg);
        return;
      } catch (err) {
        if (err instanceof NonRetryableError || attempt === this.maxAttempts) {
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
  // 05-T4: AWS requires FIFO queue names to end with `.fifo`. Preserve the
  // suffix and only sanitise the base so the broker accepts the FIFO create.
  if (isFifoTopic(topic)) {
    const base = topic.slice(0, -".fifo".length).replace(/\./g, "-").slice(0, 75);
    return `${base}.fifo`;
  }
  return topic.replace(/\./g, "-").slice(0, 80);
}

// QUE-FANOUT: cross-service fan-out fix. Previously every service that subscribed
// to a topic polled the SAME topic-named SQS queue -> competing consumers, so a
// multi-subscriber event (e.g. procurement.grn.accepted, consumed by finance +
// stock + asset + inventory) was delivered to only ONE service. Now each service
// gets its OWN queue per topic ("<topic-base>__<service>") and publish() fans a
// copy out to every subscriber queue it discovers (SNS-style, registry-free).
const TOPIC_BASE_MAX = 45;
function topicBaseName(topic: string): string {
  const raw = (isFifoTopic(topic) ? topic.slice(0, -".fifo".length) : topic).replace(/\./g, "-");
  return raw.slice(0, TOPIC_BASE_MAX);
}
function sanitizeService(service: string): string {
  return service.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 24);
}
function perServiceQueueName(topic: string, service: string): string {
  const name = `${topicBaseName(topic)}__${sanitizeService(service)}`;
  return isFifoTopic(topic) ? `${name}.fifo` : name;
}
function topicQueuePrefix(topic: string): string {
  // service-independent prefix so ListQueues finds every subscriber's queue; the
  // "__" delimiter prevents a shorter topic prefix matching a longer topic.
  return `${topicBaseName(topic)}__`;
}

export class SqsQueue implements Queue {
  private client: SQSClient;
  private handlers = new Map<string, Handler[]>();
  private queueUrls = new Map<string, string>();
  private dlqUrls = new Map<string, string>();
  private subUrlCache = new Map<string, { urls: string[]; exp: number }>();
  private polling = false;
  private pollLoops: Promise<void>[] = [];
  private readonly service: string;
  private readonly maxReceiveCount: number;
  private readonly visibilityTimeout: number;

  constructor() {
    // QUE-FANOUT: the per-service queue name needs a DISTINCT service id.
    // Under pm2, SERVICE_NAME/npm_package_name are unset and process.argv[1]
    // is the pm2 wrapper, but pm2 sets pm_exec_path to the app's own script
    // (.../services/<name>/dist/index.js). Derive the service id from it.
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
    const name = perServiceQueueName(topic, this.service);
    const fifo = isFifoTopic(topic);
    await this.client.send(new CreateQueueCommand({
      QueueName: name,
      // 05-T4: FIFO topics create FIFO queues. ContentBasedDeduplication stays
      // off because publish() supplies an explicit MessageDeduplicationId.
      ...(fifo ? { Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" } } : {}),
    }));
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
    const fifo = isFifoTopic(topic);
    // 05-T4: a FIFO source queue requires a FIFO dead-letter queue (the
    // RedrivePolicy target must match the queue type), and the name must keep
    // the `.fifo` suffix.
    const base = perServiceQueueName(topic, this.service);
    const name = fifo
      ? `${base.slice(0, -".fifo".length).slice(0, 71)}-dlq.fifo`
      : `${base.slice(0, 76)}-dlq`;
    await this.client.send(new CreateQueueCommand({
      QueueName: name,
      ...(fifo ? { Attributes: { FifoQueue: "true", ContentBasedDeduplication: "false" } } : {}),
    }));
    const res = await this.client.send(new GetQueueUrlCommand({ QueueName: name }));
    const url = res.QueueUrl!;
    this.dlqUrls.set(topic, url);
    return url;
  }

  // QUE-FANOUT: discover every subscriber's per-service queue for the topic and
  // send each a copy (cached briefly to avoid ListQueues on every publish).
  private async resolveSubscriberQueues(topic: string): Promise<string[]> {
    const now = Date.now();
    const cached = this.subUrlCache.get(topic);
    if (cached && cached.exp > now) return cached.urls;
    const res = await this.client.send(new ListQueuesCommand({
      QueueNamePrefix: topicQueuePrefix(topic), MaxResults: 1000,
    }));
    const urls = (res.QueueUrls ?? []).filter((u) => {
      const n = u.split("/").pop() ?? "";
      return !n.endsWith("-dlq") && !n.endsWith("-dlq.fifo");
    });
    this.subUrlCache.set(topic, { urls, exp: now + 15000 });
    return urls;
  }

  async publish<T>(topic: string, input: PublishInput<T>, options?: PublishOptions): Promise<string> {
    const msg = envelope(input);
    const urls = await this.resolveSubscriberQueues(topic);
    const body = JSON.stringify(msg);
    const attrs = {
      messageId:     { DataType: "String" as const, StringValue: msg.messageId },
      correlationId: { DataType: "String" as const, StringValue: msg.correlationId },
      type:          { DataType: "String" as const, StringValue: msg.type },
    };
    // 05-T4: FIFO ordering/dedup preserved per send.
    const fifoFields = isFifoTopic(topic)
      ? {
          MessageGroupId: options?.messageGroupId ?? msg.tenantId,
          MessageDeduplicationId: options?.messageDeduplicationId ?? msg.messageId,
        }
      : {};
    // Fan out: one copy to every subscribing service's own queue.
    await Promise.all(urls.map((QueueUrl) =>
      this.client.send(new SendMessageCommand({
        QueueUrl, MessageBody: body, MessageAttributes: attrs, ...fifoFields,
      })),
    ));
    return msg.messageId;
  }

  subscribe<T>(topic: string, handler: Handler<T>): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as Handler);
    this.handlers.set(topic, list);
  }

  async start(): Promise<void> {
    this.polling = true;
    // QUE-FANOUT: pre-create each queue SEQUENTIALLY before starting the poll
    // loops. Each service now owns a queue per topic, so starting N poll loops
    // at once fired a burst of ~6*N concurrent SQS calls that could exhaust the
    // connection pool and leave later queues uncreated. Serial creation is a
    // one-time boot cost and reliable; pollTopic then hits the cache.
    for (const topic of this.handlers.keys()) {
      try { await this.getOrCreateQueue(topic); }
      catch (err) { this.logHandlerError(topic, null, 0, err); }
    }
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
    // QUE-FANOUT: harden queue resolution. Each service now creates its OWN
    // queue per topic, so there is much more create-work at boot; a transient
    // LocalStack/SQS error here must RETRY, not become an unhandled rejection
    // that kills the worker (previously this await was uncaught).
    let url: string | undefined;
    while (this.polling && !url) {
      try { url = await this.getOrCreateQueue(topic); }
      catch (err) {
        this.logHandlerError(topic, null, 0, err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!url) return;
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

        // 09-T4: a successful receive means the poll loop is alive. Record a
        // heartbeat so readiness (consumerHeartbeatCheck) can detect a hung or
        // killed loop and flip /ready to 503.
        recordConsumerHeartbeat(this.service);

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

          // 04-T3: runtime envelope validation at the consume boundary. A
          // structurally invalid envelope (missing/blank required field, bad
          // messageId, missing schemaVersion) can never reach a handler — it is
          // dead-lettered once and deleted, mirroring the unparseable-body path.
          const parsed = parseEnvelope(msg);
          if (!parsed.ok) {
            incrementConsumerError(this.service, topic);
            captureError(new Error(`invalid_envelope: ${parsed.error}`), {
              service: this.service,
              topic,
              messageId: msg.messageId,
              correlationId: msg.correlationId,
            });
            await this.routeToDlq(topic, sqsMsg.Body ?? "", "invalid_envelope");
            await this.deleteSqsMessage(url, sqsMsg.ReceiptHandle!);
            continue;
          }

          const receiveCount = Number(sqsMsg.Attributes?.ApproximateReceiveCount ?? "1");

          // QUE-1: per-message handling. A failure in one handler is logged +
          // counted and leaves the message for redelivery; it does NOT silently
          // vanish. Success of all handlers is required before delete.
          let allHandled = true;
          let nonRetryableHandled = false;
          for (const h of handlers) {
            try {
              await h(msg);
            } catch (err) {
              if (err instanceof NonRetryableError) {
                // Permanent domain error — dead-letter immediately without retry.
                incrementConsumerError(this.service, topic);
                captureError(err, { service: this.service, topic, messageId: msg.messageId, correlationId: msg.correlationId, receiveCount });
                this.logHandlerError(topic, msg, receiveCount, err);
                await this.routeToDlq(topic, sqsMsg.Body ?? "", "non_retryable_error");
                await this.deleteSqsMessage(url, sqsMsg.ReceiptHandle!);
                nonRetryableHandled = true;
                break;
              }
              allHandled = false;
              incrementConsumerError(this.service, topic);
              captureError(err, { service: this.service, topic, messageId: msg.messageId, correlationId: msg.correlationId, receiveCount });
              this.logHandlerError(topic, msg, receiveCount, err);
            }
          }

          if (nonRetryableHandled) continue;

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
        "Set QUEUE_DRIVER=sqs (AWS) or QUEUE_DRIVER=rabbitmq (on-prem) or QUEUE_DRIVER=memory (explicit local dev).",
    );
  }
  if (raw === "sqs") return "sqs";
  if (raw === "rabbitmq") return "rabbitmq";
  if (raw === "memory") return "memory";
  throw new Error(`FATAL: unknown QUEUE_DRIVER "${raw}" — valid values: memory, sqs, rabbitmq`);
}

export function createQueue(): Queue {
  const driver = resolveQueueDriver();
  if (driver === "memory" && process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: QUEUE_DRIVER=memory is forbidden in production. Set QUEUE_DRIVER=sqs or QUEUE_DRIVER=rabbitmq.",
    );
  }
  let q: Queue;
  switch (driver) {
    case "memory": q = new MemoryQueue(); break;
    case "sqs":    q = new SqsQueue(); break;
    case "rabbitmq": q = new RabbitMqQueue(); break;
    default:       throw new Error(`Unknown QUEUE_DRIVER: "${driver}"`);
  }
  // RLS-CONSUMER: decorate subscribe so every handler runs inside a tenant
  // context. FORCE-RLS services connect in prod as NOBYPASSRLS roles; a queue
  // consumer that never sets the app.tenant_id GUC has all its writes rejected
  // (fails closed). withTenantConsumer runs the handler through runWithTenant
  // when msg.tenantId is present (tenant-less messages are unaffected), so the
  // tenant-aware db wrapper sets the GUC on the consumer write path. Services
  // that also wrap in runWithTenant just re-set the same tenantId (harmless).
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic, handler) =>
    raw(topic, withTenantConsumer(handler as Handler) as typeof handler)) as typeof q.subscribe;
  return q;
}
