export type QueueAdapter = "sqs" | "kafka" | "rabbitmq" | "memory";

export interface QueuePublishOptions {
  queue: string;
  payload: unknown;
  tenantId: string;
  correlationId: string;
  idempotencyKey?: string;
  delaySeconds?: number;
}

export interface QueueConsumeOptions {
  queue: string;
  handler: (message: IncomingMessage) => Promise<void>;
  maxRetries?: number;
  dlqQueue?: string;
}

export interface IncomingMessage {
  messageId: string;
  tenantId: string;
  payload: unknown;
  correlationId: string;
  retryCount: number;
  receivedAt: Date;
}

export interface QueueClient {
  publish(options: QueuePublishOptions): Promise<void>;
  consume(options: QueueConsumeOptions): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; adapter: QueueAdapter }>;
}
