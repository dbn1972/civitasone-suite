import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCES } from "../../topics.js";
import type { MapLayerView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export type CreateMapLayerBody = {
  name: string;
  sourceType: "tile" | "wms" | "geojson";
  url: string;
  styleJson?: Record<string, unknown> | undefined;
  zIndex: number;
  visible: boolean;
};

export type UpdateMapLayerBody = {
  name?: string | undefined;
  sourceType?: "tile" | "wms" | "geojson" | undefined;
  url?: string | undefined;
  styleJson?: Record<string, unknown> | null | undefined;
  zIndex?: number | undefined;
  visible?: boolean | undefined;
};

export async function mapLayerCreate(ctx: RequestContext, body: CreateMapLayerBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: MapLayerView = {
    id,
    name: body.name,
    sourceType: body.sourceType,
    url: body.url,
    styleJson: body.styleJson ?? null,
    zIndex: body.zIndex,
    visible: body.visible,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCES.mapLayer, id), projected);

  await queue.publish(COMMANDS.mapLayerCreate, {
    messageId: id,
    type: COMMANDS.mapLayerCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function mapLayerUpdate(ctx: RequestContext, id: string, body: UpdateMapLayerBody): Promise<Accepted> {
  await queue.publish(COMMANDS.mapLayerUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.mapLayerUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function mapLayerDelete(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.mapLayerDelete, {
    messageId: randomUUID(),
    type: COMMANDS.mapLayerDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
