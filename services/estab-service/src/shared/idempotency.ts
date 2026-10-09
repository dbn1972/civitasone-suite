import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

/**
 * Derive a command id / messageId. `_inbox.processed` dedups on messageId
 * alone, so every command must carry an id unique to (action, entity): reusing
 * the entity id for every command on it makes all but the first a silent no-op.
 *
 * With an `x-idempotency-key` the id is deterministic (a retried POST collapses
 * to one event); without one it is a fresh random UUID. `scope` should name the
 * command topic plus the target entity id. The tenant is folded in because the
 * inbox has no tenant column. Mirrors crm-service/src/shared/idempotency.ts.
 */
export function commandId(ctx: RequestContext, scope: string): string {
  if (!ctx.idempotencyKey) return idempotentId({});
  return idempotentId({ idempotencyKey: `${ctx.tenantId}:${scope}:${ctx.idempotencyKey}` });
}
