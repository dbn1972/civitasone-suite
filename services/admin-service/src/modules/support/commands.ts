import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { commandMessageId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function openBreakGlass(ctx: RequestContext, tenantId: string, ticketId: string, reason: string): Promise<Accepted> {
  // P0-1: a break-glass open keyed on the ticket dedupes a double-submit to a
  // single grant (the deterministic id falls back to the correlation id when no
  // client idempotency key is present).
  const id = commandMessageId(ctx, `breakglass:${tenantId}`, `open:${ticketId}`);
  await queue.publish(COMMANDS.breakGlassOpen, {
    messageId: id, type: COMMANDS.breakGlassOpen, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId, ticketId, reason, actorId: ctx.actorId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function closeBreakGlass(ctx: RequestContext, id: string): Promise<Accepted> {
  // P0-1 / P1-3: deterministic messageId so a re-close dedupes; the consumer
  // additionally guards on closed_at IS NULL and audits under the grant's tenant.
  const messageId = commandMessageId(ctx, `breakglass:${id}`, "close");
  await queue.publish(COMMANDS.breakGlassClose, {
    messageId, type: COMMANDS.breakGlassClose, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
