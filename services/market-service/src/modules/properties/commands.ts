import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreatePropertyInput {
  propertyCode: string;
  marketName: string;
  propertyType: string;
  location?: { address?: string; ward?: string; zone?: string; lat?: number; lng?: number } | undefined;
  area?: string | undefined;
  areaUnit?: string | undefined;
  floorNumber?: number | undefined;
  monthlyRentMinor?: bigint | undefined;
}

export async function createProperty(ctx: RequestContext, body: CreatePropertyInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createProperty, id, { id, ...body } as Record<string, unknown>);
}

export interface UpdatePropertyInput {
  marketName?: string | undefined;
  monthlyRentMinor?: bigint | undefined;
  status?: string | undefined;
  area?: string | undefined;
  areaUnit?: string | undefined;
}

export async function updateProperty(ctx: RequestContext, id: string, body: UpdatePropertyInput): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateProperty, id, { id, ...body } as Record<string, unknown>);
}
