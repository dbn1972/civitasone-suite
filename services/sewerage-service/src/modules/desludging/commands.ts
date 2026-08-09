import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface BookInput {
  address: Record<string, unknown> | null;
  tankCapacityLitres: number | null;
  requestedDate: string | null;
  requestedSlot: string | null;
  feeMinor: number | null;
}

export async function bookDesludging(ctx: RequestContext, body: BookInput): Promise<Accepted> {
  const id = randomUUID();
  const bookingNumber = `SEWD-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.desludgingBook, id, { id, bookingNumber, requestedBy: ctx.actorId, ...body });
}

export async function scheduleDesludging(ctx: RequestContext, id: string, vehicleId: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingSchedule, id, { id, vehicleId, version });
}

export async function dispatchDesludging(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingDispatch, id, { id, version });
}

export async function completeDesludging(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingComplete, id, { id, version });
}

export async function cancelDesludging(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingCancel, id, { id, version });
}
