import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateBookingInput {
  facilityId: string;
  vehicleNumber: string;
  vehicleType: string;
  spaceNumber?: string | undefined;
}

export async function createBooking(ctx: RequestContext, body: CreateBookingInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createBooking, id, { id, ...body });
}

export async function recordEntry(ctx: RequestContext, id: string, spaceNumber?: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordEntry, id, { id, spaceNumber });
}

export async function recordExit(ctx: RequestContext, id: string, paymentRef?: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordExit, id, { id, paymentRef });
}

export async function cancelBooking(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelBooking, id, { id });
}
