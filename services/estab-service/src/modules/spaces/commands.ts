/**
 * Spaces commands — queue-first publishers (CQRS). Writes apply in consumer.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateBuildingBody, CreateFloorBody, CreateRoomBody, CreateSeatBody,
  RequestAllotmentBody, AllotBody, VersionBody, ReleaseBody, CancelBody,
  CreateMaintenanceBody, MaintenanceStatusBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(
  type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId: randomUUID(), type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createBuilding(ctx: RequestContext, body: CreateBuildingBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.spaceBuildingCreate, ctx, id, { ...body });
}

export async function createFloor(ctx: RequestContext, body: CreateFloorBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.spaceFloorCreate, ctx, id, { ...body });
}

export async function createRoom(ctx: RequestContext, body: CreateRoomBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.spaceRoomCreate, ctx, id, { ...body });
}

export async function createSeat(ctx: RequestContext, body: CreateSeatBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.spaceSeatCreate, ctx, id, { ...body });
}

export async function requestAllotment(ctx: RequestContext, body: RequestAllotmentBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.spaceAllotmentRequest, ctx, id, { ...body });
}

export async function allot(ctx: RequestContext, allotmentId: string, body: AllotBody): Promise<Accepted> {
  return publish(COMMANDS.spaceAllotmentAllot, ctx, allotmentId, { ...body });
}

export async function occupy(ctx: RequestContext, allotmentId: string, body: VersionBody): Promise<Accepted> {
  return publish(COMMANDS.spaceAllotmentOccupy, ctx, allotmentId, { ...body });
}

export async function release(ctx: RequestContext, allotmentId: string, body: ReleaseBody): Promise<Accepted> {
  return publish(COMMANDS.spaceAllotmentRelease, ctx, allotmentId, { ...body });
}

export async function cancelAllotment(ctx: RequestContext, allotmentId: string, body: CancelBody): Promise<Accepted> {
  return publish(COMMANDS.spaceAllotmentCancel, ctx, allotmentId, { ...body });
}

export async function createMaintenance(ctx: RequestContext, body: CreateMaintenanceBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.spaceMaintenanceCreate, ctx, id, { ...body });
}

export async function updateMaintenanceStatus(
  ctx: RequestContext, id: string, body: MaintenanceStatusBody,
): Promise<Accepted> {
  return publish(COMMANDS.spaceMaintenanceStatus, ctx, id, { ...body });
}
