/**
 * identity/commands.ts — publishes identity mutation commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function resolveCreate(
  ctx: RequestContext,
  body: {
    identifiers: Array<{ type: string; value: string }>;
    attributes: Record<string, unknown>;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.resolveIdentity, id, { id, action: "create", ...body });
}

export async function resolveAmbiguous(
  ctx: RequestContext,
  body: {
    sourceProfileId: string;
    targetProfileId: string;
    confidence: string;
    matchReason: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.resolveIdentity, id, { id, action: "ambiguous", ...body });
}

export async function unlinkIdentity(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.identityUnlink, id, { id });
}
