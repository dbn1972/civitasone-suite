import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

function publish(ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>): Promise<string> {
  return queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
}

export async function createHotspot(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.roadHotspotCreate, id, { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function linkTicket(
  ctx: RequestContext,
  hotspotId: string,
  ticketId: string,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.roadHotspotLinkTicket, id, { id, hotspotId, ticketId });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function planMaintenance(
  ctx: RequestContext,
  hotspotId: string,
  maintenancePlanRef: string,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.roadHotspotPlanMaintenance, randomUUID(), { hotspotId, maintenancePlanRef });
  return { id: hotspotId, status: "accepted", correlationId: ctx.correlationId };
}

export async function resolveHotspot(
  ctx: RequestContext,
  hotspotId: string,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.roadHotspotResolve, randomUUID(), { hotspotId });
  return { id: hotspotId, status: "accepted", correlationId: ctx.correlationId };
}
