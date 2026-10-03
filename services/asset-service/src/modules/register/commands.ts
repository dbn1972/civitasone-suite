import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as enterpriseRepo from "../enterprise/repo.js";
import type { CreateAssetBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAsset(ctx: RequestContext, body: CreateAssetBody): Promise<Accepted> {
  // GAP-ASSETS-REGISTER-08: the asset code identifies the asset in the register
  // and on printed tags; refuse a second asset with the same code per tenant.
  if (await repo.findAssetByCode(ctx.tenantId, body.code)) {
    throw new HttpError(409, "DUPLICATE_CODE", `asset code ${body.code} already exists`);
  }
  // GAP-ASSETS-LOCATIONS-03: a referenced location must exist in this tenant and be active.
  let locationText = body.location;
  if (body.locationId) {
    const loc = await enterpriseRepo.findLocationById(ctx.tenantId, body.locationId);
    if (!loc) throw new HttpError(400, "INVALID_LOCATION", "location not found");
    if (!loc.isActive) throw new HttpError(409, "LOCATION_INACTIVE", "location is deactivated");
    locationText = locationText ?? loc.name;
  }
  // GAP-ASSETS-SCAN-06: a user-chosen barcode must be unique within the tenant.
  if (body.barcode && (await enterpriseRepo.findAssetByBarcode(ctx.tenantId, body.barcode))) {
    throw new HttpError(409, "DUPLICATE_BARCODE", `barcode ${body.barcode} is already assigned to another asset`);
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.assetCreate, {
    messageId: id, type: COMMANDS.assetCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, ...(locationText !== undefined ? { location: locationText } : {}) },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function tagBarcode(ctx: RequestContext, assetId: string, barcode: string): Promise<Accepted> {
  // GAP-ASSETS-SCAN-06: barcode is unique per tenant (also enforced by uq_asset_assets_tenant_barcode).
  const holder = await enterpriseRepo.findAssetByBarcode(ctx.tenantId, barcode);
  if (holder && holder.id !== assetId) {
    throw new HttpError(409, "DUPLICATE_BARCODE", `barcode ${barcode} is already assigned to another asset`);
  }
  const messageId = randomUUID();
  await queue.publish(COMMANDS.assetTagBarcode, {
    messageId, type: COMMANDS.assetTagBarcode,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: assetId, tenantId: ctx.tenantId, barcode },
  });
  return { id: assetId, status: "accepted", correlationId: ctx.correlationId };
}
