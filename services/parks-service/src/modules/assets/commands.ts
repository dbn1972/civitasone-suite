import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateAssetInput {
  assetType: string;
  name: string | null;
  location: Record<string, unknown> | null;
  area: string | null;
  areaUnit: string | null;
}

export async function createAsset(ctx: RequestContext, body: CreateAssetInput): Promise<Accepted> {
  const id = randomUUID();
  const assetCode = `PRKA-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.CREATE_ASSET, id, { id, assetCode, ...body });
}

export async function updateAsset(ctx: RequestContext, id: string, patch: Record<string, unknown>, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.UPDATE_ASSET, id, { id, patch, version });
}

export async function recordMaintenance(ctx: RequestContext, id: string, maintenanceEntry: Record<string, unknown>, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.RECORD_MAINTENANCE, id, { id, maintenanceEntry, version });
}
