import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCES } from "../../topics.js";
import type { CreateGeofenceBody, UpdateGeofenceBody, GeofenceCheckBody } from "./validators.js";
import type { GeofenceView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function geofenceCreate(ctx: RequestContext, body: CreateGeofenceBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: GeofenceView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    type: body.type,
    centerLat: body.centerLat,
    centerLng: body.centerLng,
    radiusMeters: body.radiusMeters,
    polygon: body.polygon ?? null,
    active: body.active,
    version: 1,
  };

  try {
    await cache.put(cache.makeKey(ctx.tenantId, RESOURCES.geofence, id), projected);
  } catch {
    // Cache unavailable (e.g. Redis down in staging) — skip warm-up, worker will populate after consume.
  }

  await queue.publish(COMMANDS.geofenceCreate, {
    messageId: id,
    type: COMMANDS.geofenceCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function geofenceUpdate(ctx: RequestContext, id: string, body: UpdateGeofenceBody): Promise<Accepted> {
  await queue.publish(COMMANDS.geofenceUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.geofenceUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function geofenceCheck(ctx: RequestContext, geofenceId: string, body: GeofenceCheckBody): Promise<Accepted> {
  const checkId = randomUUID();
  await queue.publish(COMMANDS.geofenceCheck, {
    messageId: checkId,
    type: COMMANDS.geofenceCheck,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { geofenceId, lat: body.lat, lng: body.lng },
  });

  return { id: checkId, status: "accepted", correlationId: ctx.correlationId };
}
