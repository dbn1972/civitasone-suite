/**
 * Infrastructure singletons: queue + cache for inspection-service.
 * Rule: every query handler consults the cache (read-through) before Postgres;
 * writes never touch the read path — the consumer invalidates here.
 */
import type { Logger } from "pino";
import { Cache } from "@civitasone/cache";
import { createQueue } from "@civitasone/queue";
import { SERVICE } from "../topics.js";

export const cache = new Cache({
  service: SERVICE,
  defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60),
});

export const queue = createQueue();

/**
 * Best-effort cache invalidation for the write path: invalidate one key (or
 * several, concurrently, when a write touches more than one cached
 * resource) after the DB transaction has committed, swallowing any failure
 * so a cache-layer blip never turns an already-committed write into a
 * retried/redelivered message. Every consumer.ts in this service repeats
 * this exact "invalidate, log-and-continue on failure" shape after each
 * handler's transaction — this is the one place that logic lives.
 *
 * `context` carries whatever extra fields a call site logs alongside `err`
 * (e.g. `{ tenantId: msg.tenantId, capaId }`) — merged into the warn payload
 * ahead of the fixed `event: "cache_invalidate_failed"` field, preserving
 * the same field order call sites used before this was extracted.
 *
 * `message` defaults to the generic text most call sites used verbatim, but
 * about half of this service's call sites (the ones logging extra context)
 * instead wrote a specific message per handler (e.g. "failed to invalidate
 * capa cache after create") — pass that string through unchanged so this
 * extraction doesn't flatten those into one generic message.
 */
export async function invalidateSafely(
  key: string | string[],
  log: Logger,
  context?: Record<string, unknown>,
  message = "cache invalidation failed",
): Promise<void> {
  try {
    if (Array.isArray(key)) {
      await Promise.all(key.map((k) => cache.invalidate(k)));
    } else {
      await cache.invalidate(key);
    }
  } catch (err) {
    log.warn({ err, ...context, event: "cache_invalidate_failed" }, message);
  }
}
