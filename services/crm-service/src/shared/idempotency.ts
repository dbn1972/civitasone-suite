import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

/**
 * R2: derive a command's entity id / messageId from the client's
 * `x-idempotency-key` so a retried POST collapses to a single row and a single
 * event — crm consumers dedupe on messageId via `_inbox.processed`.
 *
 * `scope` keeps one reused client key from colliding across unrelated writes:
 * it carries the command topic, the target entity id for per-entity mutations,
 * and a discriminator when one request allocates several ids. With no key the
 * behaviour is unchanged — a fresh random id per request.
 */
export function commandId(ctx: RequestContext, scope: string): string {
  if (!ctx.idempotencyKey) return idempotentId({});
  return idempotentId({ idempotencyKey: `${scope}:${ctx.idempotencyKey}` });
}
