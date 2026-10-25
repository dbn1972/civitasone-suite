import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface IdentifyHotspotInput {
  location: Record<string, unknown> | null;
  category: string | null;
  complaintCount: number;
}

export async function identifyHotspot(ctx: RequestContext, body: IdentifyHotspotInput): Promise<Accepted> {
  const id = randomUUID();
  // hotspotCode is allocated by the consumer from a Postgres sequence, inside the insert transaction (shared/numbers.ts).
  return publishCommand(ctx, COMMANDS.hotspotIdentify, id, { id, ...body });
}

export async function resolveHotspot(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.hotspotResolve, id, { id, version });
}
