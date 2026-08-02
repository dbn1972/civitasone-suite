import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(topic: string, ctx: RequestContext, payload: Record<string, unknown>): Promise<Accepted> {
  const id = (payload.id as string | undefined) ?? randomUUID();
  await queue.publish(topic, {
    messageId: id,
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function createLegalEntity(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(COMMANDS.legalEntityCreate, ctx, body);
}
export function createOperatingUnit(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(COMMANDS.operatingUnitCreate, ctx, body);
}
export function createCostCenter(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(COMMANDS.costCenterCreate, ctx, body);
}
export function createProfitCenter(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(COMMANDS.profitCenterCreate, ctx, body);
}
