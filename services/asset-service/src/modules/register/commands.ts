import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { CreateAssetBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAsset(ctx: RequestContext, body: CreateAssetBody): Promise<Accepted> {
  // GAP-ASSETS-REGISTER-08: the asset code identifies the asset in the register
  // and on printed tags; refuse a second asset with the same code per tenant.
  if (await repo.findAssetByCode(ctx.tenantId, body.code)) {
    throw new HttpError(409, "DUPLICATE_CODE", `asset code ${body.code} already exists`);
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.assetCreate, {
    messageId: id, type: COMMANDS.assetCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function tagBarcode(ctx: RequestContext, assetId: string, barcode: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.assetTagBarcode, {
    messageId, type: COMMANDS.assetTagBarcode,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: assetId, tenantId: ctx.tenantId, barcode },
  });
  return { id: assetId, status: "accepted", correlationId: ctx.correlationId };
}
