import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateFacilityInput {
  facilityName: string;
  facilityType: string;
  address: { line1: string; line2?: string | undefined; city: string; pin: string; ward?: string | undefined };
  ward?: string | undefined;
  totalSlots: number;
  operatingHours?: { open: string; close: string; days?: string[] | undefined } | undefined;
  contactPerson?: string | undefined;
  contactPhone?: string | undefined;
}

export async function createFacility(ctx: RequestContext, body: CreateFacilityInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createFacility, id, { id, ...body });
}

export interface UpdateFacilityInput {
  facilityName?: string | undefined;
  totalSlots?: number | undefined;
  operatingHours?: { open: string; close: string; days?: string[] | undefined } | undefined;
  contactPerson?: string | undefined;
  contactPhone?: string | undefined;
  status?: string | undefined;
}

export async function updateFacility(ctx: RequestContext, id: string, body: UpdateFacilityInput): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateFacility, id, { id, ...body });
}
