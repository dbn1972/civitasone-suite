import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateFuelLogBody, CreateTripLogBody, CompleteTripBody,
  CreateVehicleDocBody, CreateDriverRosterBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

// `messageId` is the idempotency key markProcessed() dedups on. Defaults to the entity id (fresh on
// create); follow-up commands on an existing entity MUST pass a per-command id or they collide with
// the create's inbox row and are silently dropped.
async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>, messageId: string = id): Promise<void> {
  await queue.publish(type, {
    messageId, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createFuelLog(ctx: RequestContext, body: CreateFuelLogBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.fuelLogCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createTripLog(ctx: RequestContext, body: CreateTripLogBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.tripLogCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeTrip(ctx: RequestContext, tripId: string, body: CompleteTripBody): Promise<Accepted> {
  await publish(COMMANDS.tripLogComplete, ctx, tripId, { id: tripId, tenantId: ctx.tenantId, ...body }, randomUUID());
  return { id: tripId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createVehicleDoc(ctx: RequestContext, body: CreateVehicleDocBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.vehicleDocCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createDriverRoster(ctx: RequestContext, body: CreateDriverRosterBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.driverRosterCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
