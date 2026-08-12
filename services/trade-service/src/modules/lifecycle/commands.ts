import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function requestRenewal(ctx: RequestContext, licenceId: string, renewalType: string, details?: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestRenewal, id, { id, licenceId, renewalType, details });
}

export async function decideRenewal(ctx: RequestContext, id: string, decision: string, reason?: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideRenewal, id, { id, decision, reason });
}
