import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

interface CmdCtx { tenantId: string; actorId: string; correlationId: string }

function publish(type: string, ctx: CmdCtx, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  return queue.publish(type, {
    messageId, type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  }).then(() => ({ id: payload.id as string, status: "accepted" as const, correlationId: ctx.correlationId }));
}

export function createBooking(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.waterTankerBookingCreate, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function scheduleBooking(ctx: CmdCtx, bookingId: string, data: Record<string, unknown>) {
  return publish(COMMANDS.waterTankerBookingSchedule, ctx, { id: bookingId, tenantId: ctx.tenantId, ...data });
}

export function dispatchBooking(ctx: CmdCtx, bookingId: string) {
  return publish(COMMANDS.waterTankerBookingDispatch, ctx, { id: bookingId, tenantId: ctx.tenantId });
}

export function deliverBooking(ctx: CmdCtx, bookingId: string) {
  return publish(COMMANDS.waterTankerBookingDeliver, ctx, { id: bookingId, tenantId: ctx.tenantId });
}

export function cancelBooking(ctx: CmdCtx, bookingId: string) {
  return publish(COMMANDS.waterTankerBookingCancel, ctx, { id: bookingId, tenantId: ctx.tenantId });
}
