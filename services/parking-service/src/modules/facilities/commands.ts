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
  totalSpaces: number;
  operatingHours?: { open: string; close: string; days?: string[] | undefined } | undefined;
  // Canonical minor-unit STRINGS (see zMoneyMinorStringNonNeg in
  // facilities/routes.ts), not bigint and not a raw number: a bigint isn't
  // JSON-serializable on the real SQS/RabbitMQ queue.publish() drivers, and a
  // plain number can silently lose precision above 2^53 before it ever
  // reaches BigInt(). The consumer rebuilds the exact bigint with
  // BigInt(string) right before the Drizzle insert/update.
  tariffPerHourMinor?: string | undefined;
  tariffPerDayMinor?: string | undefined;
  monthlyPassMinor?: string | undefined;
  annualPassMinor?: string | undefined;
  contactPerson?: string | undefined;
}

export async function createFacility(ctx: RequestContext, body: CreateFacilityInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createFacility, id, { id, ...body } as Record<string, unknown>);
}

export interface UpdateFacilityInput {
  facilityName?: string | undefined;
  totalSpaces?: number | undefined;
  availableSpaces?: number | undefined;
  operatingHours?: { open: string; close: string; days?: string[] | undefined } | undefined;
  // Same canonical minor-unit STRING contract as CreateFacilityInput above.
  tariffPerHourMinor?: string | undefined;
  tariffPerDayMinor?: string | undefined;
  monthlyPassMinor?: string | undefined;
  annualPassMinor?: string | undefined;
  status?: string | undefined;
  contactPerson?: string | undefined;
}

export async function updateFacility(ctx: RequestContext, id: string, body: UpdateFacilityInput): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateFacility, id, { id, ...body } as Record<string, unknown>);
}
