import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function openBreakGlass(ctx: RequestContext, tenantId: string, ticketId: string, reason: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.breakGlassOpen, {
    messageId: id, type: COMMANDS.breakGlassOpen, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId, ticketId, reason, actorId: ctx.actorId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function closeBreakGlass(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.breakGlassClose, {
    type: COMMANDS.breakGlassClose, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
