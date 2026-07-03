import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCES } from "../../topics.js";
import type { CreateUnitBody, UpdateUnitBody, BulkSyncBody } from "./validators.js";
import type { AdministrativeUnitView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };
export type BulkAccepted = { count: number; status: string; correlationId: string };

export async function unitCreate(ctx: RequestContext, body: CreateUnitBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: AdministrativeUnitView = {
    id,
    tenantId: ctx.tenantId,
    code: body.code,
    name: body.name,
    type: body.type,
    parentId: body.parentId ?? null,
    population: body.population ?? null,
    areaKm2: body.areaKm2 ?? null,
    pinCodes: body.pinCodes ?? null,
    lgdCode: body.lgdCode ?? null,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCES.unit, id), projected);

  await queue.publish(COMMANDS.unitCreate, {
    messageId: id,
    type: COMMANDS.unitCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function unitUpdate(ctx: RequestContext, id: string, body: UpdateUnitBody): Promise<Accepted> {
  await queue.publish(COMMANDS.unitUpdate, {
    messageId: `${id}-${Date.now()}`,
    type: COMMANDS.unitUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function unitBulkSync(ctx: RequestContext, body: BulkSyncBody): Promise<BulkAccepted> {
  const batchId = randomUUID();

  await queue.publish(COMMANDS.unitBulkSync, {
    messageId: batchId,
    type: COMMANDS.unitBulkSync,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { batchId, units: body.units },
  });

  return { count: body.units.length, status: "accepted", correlationId: ctx.correlationId };
}
