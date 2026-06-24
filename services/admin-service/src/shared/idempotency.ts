import { createHash } from "node:crypto";
import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

/**
 * P0-1: produce a *deterministic* messageId for a state-change publish so a
 * double-submit dedupes at the consumer (`_inbox.processed`) -- not just for
 * create flows that already use `idempotentId(ctx)`.
 *
 * Precedence:
 *   1. An explicit client idempotency key (x-idempotency-key) -> idempotentId(ctx).
 *      Same key => same id, even across distinct correlation ids.
 *   2. Otherwise a stable hash of (entity + action + correlationId). A retried
 *      HTTP request reuses its x-correlation-id, so the retry collapses to one
 *      effect, while genuinely distinct operations (their own correlation id)
 *      stay distinct and are not silently swallowed.
 */
export function commandMessageId(ctx: RequestContext, entity: string, action: string): string {
  if (ctx.idempotencyKey) return idempotentId(ctx);
  const h = createHash("sha256")
    .update(`${entity} ${action} ${ctx.correlationId}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
