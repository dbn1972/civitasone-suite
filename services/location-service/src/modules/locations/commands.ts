import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateLocationBody } from "./validators.js";
import type { LocationView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createLocation(ctx: RequestContext, body: CreateLocationBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: LocationView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    addressLine: body.addressLine ?? null,
    city: body.city ?? null,
    postalCode: body.postalCode ?? null,
    parentId: body.parentId ?? null,
    type: body.type,
    lgdCode: body.lgdCode ?? null,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    status: "active",
    isSample: false,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createLocation, {
    messageId: id,
    type: COMMANDS.createLocation,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function archiveLocation(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  await queue.publish(COMMANDS.archiveLocation, {
    messageId: randomUUID(),
    type: COMMANDS.archiveLocation,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: reason ?? null },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
