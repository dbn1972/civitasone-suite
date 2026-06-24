import { pino } from "pino";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import * as dlq from "./repo.js";

const log = pino({ name: "workflow-dlq" });

/**
 * Gap 3 — consumer-side DLQ wrapper. Wraps a handler so that:
 *  - on success: clears the per-message attempt counter and returns normally;
 *  - on failure BELOW maxAttempts: bumps the attempt counter and RE-THROWS, so
 *    the broker redelivers (transient failures still retry and can succeed);
 *  - on failure AT/ABOVE maxAttempts: records the message (envelope + last
 *    error) into workflow.dead_letters and SWALLOWS the error, so the poison
 *    message stops looping forever. An admin can later list/requeue it.
 *
 * maxAttempts default 5 (override via WORKFLOW_DLQ_MAX_ATTEMPTS).
 */
export function dlqWrap(
  topic: string,
  handler: (msg: CommandEnvelope) => Promise<void>,
  maxAttempts = Number(process.env.WORKFLOW_DLQ_MAX_ATTEMPTS ?? 5),
): (msg: CommandEnvelope) => Promise<void> {
  return async (msg: CommandEnvelope) => {
    try {
      await handler(msg);
      await dlq.clearAttempts(topic, msg.messageId).catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempt = await dlq.bumpAttempt(topic, msg.messageId, msg.tenantId, message);
      if (attempt >= maxAttempts) {
        await dlq.deadLetter(topic, msg.messageId, msg.tenantId, msg as unknown as Record<string, unknown>, message, attempt);
        log.error({ topic, messageId: msg.messageId, attempt, err: message }, "message dead-lettered after max attempts");
        return; // swallow: stop the broker redelivering a poison message
      }
      log.warn({ topic, messageId: msg.messageId, attempt, maxAttempts }, "handler failed; will retry");
      throw err; // below threshold: let the broker redeliver
    }
  };
}

/** subscribe `handler` wrapped with the consumer-side DLQ policy. */
export function subscribeWithDlq<T>(
  queue: Queue,
  topic: string,
  handler: (msg: CommandEnvelope<T>) => Promise<void>,
): void {
  queue.subscribe<T>(topic, dlqWrap(topic, handler as (msg: CommandEnvelope) => Promise<void>) as (msg: CommandEnvelope<T>) => Promise<void>);
}
