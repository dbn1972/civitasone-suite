import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createFacility(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.bookingFacilityCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateFacility(ctx: RequestContext, facilityId: string, body: Record<string, unknown>): Promise<Accepted> {
  await publish(COMMANDS.bookingFacilityUpdate, ctx, facilityId, { id: facilityId, tenantId: ctx.tenantId, ...body });
  return { id: facilityId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createBooking(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.bookingCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitBooking(ctx: RequestContext, bookingId: string): Promise<Accepted> {
  await publish(COMMANDS.bookingSubmit, ctx, bookingId, { id: bookingId, tenantId: ctx.tenantId });
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveBooking(ctx: RequestContext, bookingId: string): Promise<Accepted> {
  await publish(COMMANDS.bookingApprove, ctx, bookingId, { id: bookingId, tenantId: ctx.tenantId });
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordPayment(ctx: RequestContext, bookingId: string, body: Record<string, unknown>): Promise<Accepted> {
  await publish(COMMANDS.bookingRecordPayment, ctx, bookingId, { id: bookingId, tenantId: ctx.tenantId, ...body });
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function cancelBooking(ctx: RequestContext, bookingId: string, body: Record<string, unknown>): Promise<Accepted> {
  await publish(COMMANDS.bookingCancel, ctx, bookingId, { id: bookingId, tenantId: ctx.tenantId, ...body });
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeBooking(ctx: RequestContext, bookingId: string): Promise<Accepted> {
  await publish(COMMANDS.bookingComplete, ctx, bookingId, { id: bookingId, tenantId: ctx.tenantId });
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}
