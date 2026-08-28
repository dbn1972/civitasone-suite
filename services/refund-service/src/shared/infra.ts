import { Cache } from "@civitasone/cache";
import { createQueue } from "@civitasone/queue";
import { SERVICE } from "../topics.js";

export const cache = new Cache({ service: SERVICE, defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60) });
export const queue = createQueue();

/**
 * CACHE-2: every consumer in this service used to call
 * `cache.invalidateAfterCommit(tx, key)` FROM INSIDE the `db.transaction(...)`
 * callback, passing the live `tx`. That looked right by the package's own
 * naming, but this DB layer has no real onCommit hook (see
 * @civitasone/cache's own doc comment on `invalidateAfterCommit`), so the
 * call actually falls through to an IMMEDIATE, synchronous
 * `await this.redis.del(key)` — executed as part of the transaction body,
 * not deferred to commit time. That call has no try/catch. If Redis is
 * unreachable or slow enough to throw at that moment, the exception
 * propagates out of the transaction callback and the WHOLE transaction rolls
 * back — discarding a disbursement insert / approval row / audit write that
 * had already succeeded and had nothing to do with caching. A cache-layer
 * blip must never be able to undo a financial write.
 *
 * The fix is ordering, not cleverness: every consumer now returns a plain
 * value from inside `db.transaction(...)` recording *what* (if anything)
 * needs invalidating — no cache call there at all — and invalidates for
 * real only after `await db.transaction(...)` has already resolved, i.e.
 * genuinely post-commit. This helper is that post-commit call: it uses
 * plain `cache.invalidate(key)` (there's no `tx` in scope any more, nor any
 * need for one) and swallows a failure into a warning log rather than
 * letting it throw — a missed invalidation self-heals within the entry's
 * TTL (see @civitasone/cache's own accepted trade-off for this exact DB
 * layer); a rolled-back financial write does not self-heal at all.
 */
export async function invalidateCacheSafely(
  key: string,
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void },
): Promise<void> {
  try {
    await cache.invalidate(key);
  } catch (err) {
    logger.warn({ err, key }, "cache invalidation failed after commit — entry will self-heal within its TTL");
  }
}
