/**
 * Domain rejections are permanent: a DomainError (invalid transition, expired
 * pass, over capacity, blacklisted visitor...) will fail identically on every
 * redelivery, so retrying only burns the attempt budget before the message is
 * dead-lettered anyway. Convert them to the suite-wide NonRetryableError
 * (@civitasone/queue) so the bus dead-letters them on the first attempt.
 * Anything else (DB/Redis/network failures) is rethrown untouched and keeps the
 * normal retry-with-backoff behaviour.
 *
 * Detection is by name/constructor name, not instanceof, because this service
 * has one DomainError class per module (check-in, location, digital-pass, ...)
 * and not all of them share a base class.
 */
import { pino } from "pino";
import { NonRetryableError, type Handler, type Queue, type SubscribeOptions } from "@civitasone/queue";

const log = pino({ name: "visitor-consumer-refusal" });

export function isDomainRejection(err: unknown): err is Error {
  return err instanceof Error && (err.name === "DomainError" || err.constructor?.name === "DomainError");
}

/**
 * Every non-retryable refusal (a DomainError or an explicit NonRetryableError) is logged here with its
 * reason + correlation id before it dead-letters, so the DLQ entry is never the only evidence.
 */
const LOGGED = Symbol.for("visitor.refusalLogged");
function logRefusal(topic: string | undefined, msg: { tenantId?: string; correlationId?: string; messageId?: string }, err: Error): void {
  if ((err as unknown as Record<symbol, boolean>)[LOGGED]) return; // already logged by an inner wrapper
  (err as unknown as Record<symbol, boolean>)[LOGGED] = true;
  log.warn(
    { event: "consumer_refused", topic, tenantId: msg.tenantId, correlationId: msg.correlationId, messageId: msg.messageId, reason: err.message },
    `consumer refused message (non-retryable): ${err.message}`,
  );
}

export function nonRetryableOnDomainRejection<T>(handler: Handler<T>, topic?: string): Handler<T> {
  return async (msg) => {
    try {
      await handler(msg);
    } catch (err) {
      if (isDomainRejection(err)) {
        logRefusal(topic, msg, err);
        throw new NonRetryableError(err.message, err);
      }
      if (err instanceof NonRetryableError) logRefusal(topic, msg, err);
      throw err;
    }
  };
}

/**
 * Log-only wrapper (no error conversion): used once in worker.ts around EVERY consumer so any
 * NonRetryableError a handler throws leaves a log line with topic, tenant, correlation id and reason.
 */
export function logNonRetryableRefusals<T>(handler: Handler<T>, topic: string): Handler<T> {
  return async (msg) => {
    try {
      await handler(msg);
    } catch (err) {
      if (err instanceof NonRetryableError) logRefusal(topic, msg, err);
      throw err;
    }
  };
}

/** A Queue view whose subscribe() wraps every handler with nonRetryableOnDomainRejection. */
export function domainRejectionSafe(queue: Queue): Pick<Queue, "subscribe"> {
  return {
    subscribe<T>(topic: string, handler: Handler<T>, options?: SubscribeOptions): void {
      queue.subscribe<T>(topic, nonRetryableOnDomainRejection(handler, topic), options);
    },
  };
}
