import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface RequestBookingInput {
  facilityId: string;
  applicantName: string;
  applicantPhone: string;
  applicantRelation?: string | undefined;
  deceasedName: string;
  deceasedAge?: number | undefined;
  deceasedGender?: string | undefined;
  deathCertificateRef?: string | undefined;
  serviceType: string;
  requestedDate: string;
  requestedSlot?: string | undefined;
}

export async function requestBooking(ctx: RequestContext, body: RequestBookingInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestBooking, id, { id, ...body });
}

export async function confirmBooking(ctx: RequestContext, id: string, slotNumber: string, paymentRef?: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.confirmBooking, id, { id, slotNumber, paymentRef });
}

export async function completeBooking(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeBooking, id, { id });
}

export async function cancelBooking(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelBooking, id, { id });
}
