import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CollectionRequestInput {
  wasteType: string;
  estimatedQuantity: string | null;
  address: Record<string, unknown> | null;
  preferredDate: string | null;
  preferredSlot: string | null;
  feeMinor: number | null;
}

export async function requestCollection(ctx: RequestContext, body: CollectionRequestInput): Promise<Accepted> {
  const id = randomUUID();
  const requestNumber = `SWMR-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.collectionRequest, id, { id, requestNumber, requestedBy: ctx.actorId, ...body });
}

export async function scheduleCollection(ctx: RequestContext, id: string, vehicleId: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.collectionSchedule, id, { id, vehicleId, version });
}

export async function completeCollection(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.collectionComplete, id, { id, version });
}

export async function cancelCollection(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.collectionCancel, id, { id, version });
}

export interface FieldTaskInput {
  routeId: string | null;
  zoneId: string | null;
  assignedTo: string | null;
  taskDate: string | null;
  assetRefs: string[] | null;
}

export async function createFieldTask(ctx: RequestContext, body: FieldTaskInput): Promise<Accepted> {
  const id = randomUUID();
  const taskNumber = `SWMT-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.fieldTaskCreate, id, { id, taskNumber, ...body });
}

export async function completeFieldTask(ctx: RequestContext, id: string, notes: string | null, photos: string[] | null, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.fieldTaskComplete, id, { id, notes, photos, version });
}
