import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

type Accepted = { id: string; status: string; correlationId: string };

async function publish(topic: string, ctx: RequestContext, payload: Record<string, unknown>, withResourceId = false): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(topic, {
    messageId: id, type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    // withResourceId: the returned id IS the new resource's id (the consumer inserts the row with it), so the
    // caller can use it on /contracts/:id/activate|terminate|renew. Previously the consumer read an `id` the
    // publisher never sent and the row got a different id, so every follow-up answered "not found".
    payload: { ...payload, ...(withResourceId ? { id } : {}), tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const createContract = (ctx: RequestContext, p: Record<string, unknown>) => publish(COMMANDS.contractCreate, ctx, p, true);
export const activateContract = (ctx: RequestContext, id: string, p: Record<string, unknown>) => publish(COMMANDS.contractActivate, ctx, { contractId: id, ...p });
export const terminateContract = (ctx: RequestContext, id: string, p: Record<string, unknown>) => publish(COMMANDS.contractTerminate, ctx, { contractId: id, ...p });
export const initiateRenewal = (ctx: RequestContext, id: string, p: Record<string, unknown>) => publish(COMMANDS.contractRenewalInitiate, ctx, { contractId: id, ...p });
export const bulkRenewal = (ctx: RequestContext, p: Record<string, unknown>) => publish(COMMANDS.contractRenewalBulk, ctx, p);
export const triggerExpiryDetection = (ctx: RequestContext) => publish(COMMANDS.contractExpiryDetect, ctx, {});
export const triggerAutoSeparation = (ctx: RequestContext, contractId: string) => publish(COMMANDS.contractAutoSeparate, ctx, { contractId });
