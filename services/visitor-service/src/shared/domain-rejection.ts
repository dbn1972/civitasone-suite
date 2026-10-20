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
import { NonRetryableError, type Handler, type Queue, type SubscribeOptions } from "@civitasone/queue";

export function isDomainRejection(err: unknown): err is Error {
  return err instanceof Error && (err.name === "DomainError" || err.constructor?.name === "DomainError");
}

export function nonRetryableOnDomainRejection<T>(handler: Handler<T>): Handler<T> {
  return async (msg) => {
    try {
      await handler(msg);
    } catch (err) {
      if (isDomainRejection(err)) throw new NonRetryableError(err.message, err);
      throw err;
    }
  };
}

/** A Queue view whose subscribe() wraps every handler with nonRetryableOnDomainRejection. */
export function domainRejectionSafe(queue: Queue): Pick<Queue, "subscribe"> {
  return {
    subscribe<T>(topic: string, handler: Handler<T>, options?: SubscribeOptions): void {
      queue.subscribe<T>(topic, nonRetryableOnDomainRejection(handler), options);
    },
  };
}
