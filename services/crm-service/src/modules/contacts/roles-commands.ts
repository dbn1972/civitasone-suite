import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: id, type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const createContactRole = (ctx: RequestContext, id: string, body: { contactId: string; dealId: string; role: string }) =>
  pub(ctx, COMMANDS.createContactRole, id, body);

export const deleteContactRole = (ctx: RequestContext, id: string, body: { contactId: string }) =>
  pub(ctx, COMMANDS.deleteContactRole, id, body);
