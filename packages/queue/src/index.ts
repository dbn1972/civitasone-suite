/**
 * @civitasone/queue — facade over @civitasone/queue-service.
 * Import this package in domain services; do not import SQS SDKs directly.
 */
export {
  createQueue,
  resolveQueueDriver,
  MemoryQueue,
  SqsQueue,
  createQueueClient,
  wrapQueueAsClient,
  NonRetryableError,
  isNonRetryable,
} from "@civitasone/queue-service";

export type {
  CommandEnvelope,
  PublishInput,
  Handler,
  Queue,
  QueueDriver,
  QueueAdapter,
  QueueClient,
  QueuePublishOptions,
  QueueConsumeOptions,
  IncomingMessage,
} from "@civitasone/queue-service";
