import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
export type Accepted = { id: string; status: string; correlationId: string };
async function pub(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, { messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { ...payload, id, tenantId: ctx.tenantId } });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
export const finalizeInstance = (ctx: RequestContext, id: string) => pub(ctx, COMMANDS.finalizeInstance, id, {});
export const reverseInstance = (ctx: RequestContext, id: string, body: { reason: string; impact: unknown }) =>
  pub(ctx, COMMANDS.reverseInstance, id, body);
