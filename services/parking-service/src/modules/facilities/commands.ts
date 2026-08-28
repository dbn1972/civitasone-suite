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
  // Numbers, not bigint: these go straight into a queue.publish() payload that
  // gets JSON.stringify'd on the real SQS/RabbitMQ drivers. A native bigint
  // throws there ("Do not know how to serialize a BigInt") — the consumer
  // converts to BigInt itself right before the Drizzle insert/update.
  tariffPerHourMinor?: number | undefined;
  tariffPerDayMinor?: number | undefined;
  monthlyPassMinor?: number | undefined;
  annualPassMinor?: number | undefined;
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
  // Numbers, not bigint: these go straight into a queue.publish() payload that
  // gets JSON.stringify'd on the real SQS/RabbitMQ drivers. A native bigint
  // throws there ("Do not know how to serialize a BigInt") — the consumer
  // converts to BigInt itself right before the Drizzle insert/update.
  tariffPerHourMinor?: number | undefined;
  tariffPerDayMinor?: number | undefined;
  monthlyPassMinor?: number | undefined;
  annualPassMinor?: number | undefined;
  status?: string | undefined;
  contactPerson?: string | undefined;
}

export async function updateFacility(ctx: RequestContext, id: string, body: UpdateFacilityInput): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateFacility, id, { id, ...body } as Record<string, unknown>);
}
