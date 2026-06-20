import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateVehicleBody, BookVehicleBody, ReturnVehicleBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createVehicle(ctx: RequestContext, body: CreateVehicleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vehicleCreate, {
    messageId: id, type: COMMANDS.vehicleCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function bookVehicle(ctx: RequestContext, body: BookVehicleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vehicleBook, {
    messageId: id, type: COMMANDS.vehicleBook,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function returnVehicle(ctx: RequestContext, bookingId: string, body: ReturnVehicleBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vehicleReturn, {
    type: COMMANDS.vehicleReturn,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { bookingId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vehicle_booking", bookingId));
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}
