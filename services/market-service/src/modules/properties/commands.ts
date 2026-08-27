import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreatePropertyInput {
  propertyCode: string;
  marketName: string;
  propertyType: string;
  location?: { address?: string | undefined; ward?: string | undefined; zone?: string | undefined; lat?: number | undefined; lng?: number | undefined } | undefined;
  area?: string | undefined;
  areaUnit?: string | undefined;
  floorNumber?: number | undefined;
  // number, not bigint: goes straight into a queue.publish() payload that gets
  // JSON.stringify'd on the real SQS/RabbitMQ drivers — a native bigint throws
  // there ("Do not know how to serialize a BigInt"), silently only "working" in
  // tests (MemoryQueue never serializes). The consumer converts to BigInt
  // itself right before the Drizzle insert/update.
  monthlyRentMinor?: number | undefined;
}

export async function createProperty(ctx: RequestContext, body: CreatePropertyInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createProperty, id, { id, ...body } as Record<string, unknown>);
}

export interface UpdatePropertyInput {
  marketName?: string | undefined;
  // number, not bigint: goes straight into a queue.publish() payload that gets
  // JSON.stringify'd on the real SQS/RabbitMQ drivers — a native bigint throws
  // there ("Do not know how to serialize a BigInt"), silently only "working" in
  // tests (MemoryQueue never serializes). The consumer converts to BigInt
  // itself right before the Drizzle insert/update.
  monthlyRentMinor?: number | undefined;
  status?: string | undefined;
  area?: string | undefined;
  areaUnit?: string | undefined;
}

export async function updateProperty(ctx: RequestContext, id: string, body: UpdatePropertyInput): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateProperty, id, { id, ...body } as Record<string, unknown>);
}
