import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import type { CreateOrgUnitBody, UpdateOrgUnitBody } from "./validators.js";

/**
 * Self-contained command topics for the org-hierarchy module (R1), following
 * the records module convention of keeping additively-introduced topics local
 * rather than widening the shared topics.ts surface.
 */
export const COMMANDS = {
  orgUnitCreate: "estab.org_unit.create",
  orgUnitUpdate: "estab.org_unit.update",
} as const;

export type Accepted = { id: string; status: string; correlationId: string };

export async function createOrgUnit(ctx: RequestContext, body: CreateOrgUnitBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.orgUnitCreate, {
    messageId: randomUUID(), type: COMMANDS.orgUnitCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateOrgUnit(ctx: RequestContext, id: string, body: UpdateOrgUnitBody): Promise<Accepted> {
  await queue.publish(COMMANDS.orgUnitUpdate, {
    messageId: randomUUID(), type: COMMANDS.orgUnitUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, patch: body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "org_unit", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
