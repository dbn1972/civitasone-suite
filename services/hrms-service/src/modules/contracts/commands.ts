import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

type Accepted = { id: string; status: string; correlationId: string };

async function publish(topic: string, ctx: RequestContext, payload: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(topic, {
    messageId: id, type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const createContract = (ctx: RequestContext, p: Record<string, unknown>) => publish(COMMANDS.contractCreate, ctx, p);
export const activateContract = (ctx: RequestContext, id: string, p: Record<string, unknown>) => publish(COMMANDS.contractActivate, ctx, { contractId: id, ...p });
export const terminateContract = (ctx: RequestContext, id: string, p: Record<string, unknown>) => publish(COMMANDS.contractTerminate, ctx, { contractId: id, ...p });
export const initiateRenewal = (ctx: RequestContext, id: string, p: Record<string, unknown>) => publish(COMMANDS.contractRenewalInitiate, ctx, { contractId: id, ...p });
export const bulkRenewal = (ctx: RequestContext, p: Record<string, unknown>) => publish(COMMANDS.contractRenewalBulk, ctx, p);
export const triggerExpiryDetection = (ctx: RequestContext) => publish(COMMANDS.contractExpiryDetect, ctx, {});
export const triggerAutoSeparation = (ctx: RequestContext, contractId: string) => publish(COMMANDS.contractAutoSeparate, ctx, { contractId });
