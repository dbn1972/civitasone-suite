import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { CreateAssetBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAsset(ctx: RequestContext, body: CreateAssetBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.assetCreate, {
    messageId: id, type: COMMANDS.assetCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function tagBarcode(ctx: RequestContext, assetId: string, barcode: string): Promise<Accepted> {
  await db.transaction(async (tx) => {
    await repo.updateAssetBarcode(tx, assetId, ctx.tenantId, barcode, ctx.actorId);
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "asset", assetId));
  return { id: assetId, status: "accepted", correlationId: ctx.correlationId };
}
