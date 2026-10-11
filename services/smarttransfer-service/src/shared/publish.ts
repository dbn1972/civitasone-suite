import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { stableUuid } from "@civitasone/outbox";
import { queue } from "./infra.js";

export type Accepted = { commandId: string; statusUrl: string };

/**
 * Publish a COMMAND with an EXPLICIT per-command messageId (house rule 1).
 *
 * The messageId is the command id, NEVER the entity id: when the caller sends
 * `x-idempotency-key` it is deterministic (stableUuid over
 * `<tenantId>:<actorId>:<topic>:<idempotencyKey>`, so two tenants/actors reusing
 * a key never collide on markProcessed), so a double-submit dedupes at the consumer's
 * markProcessed; otherwise it is random so distinct commands never collide.
 * The 202 returns `{ commandId, statusUrl }` so the caller can poll
 * GET /v1/smarttransfer/commands/:commandId.
 */
export async function publishCommand(
  ctx: RequestContext,
  type: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  const commandId = ctx.idempotencyKey
    ? stableUuid(`${ctx.tenantId}:${ctx.actorId}:${type}:${ctx.idempotencyKey}`)
    : randomUUID();
  await queue.publish(type, {
    messageId: commandId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { commandId, statusUrl: `/v1/smarttransfer/commands/${commandId}` };
}
