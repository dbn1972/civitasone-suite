import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function requestRenewal(ctx: RequestContext, licenceId: string): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestRenewal, id, { id, licenceId, renewalType: "renewal" });
}

export async function requestZoneTransfer(
  ctx: RequestContext,
  licenceId: string,
  newZone: string,
  newSpot: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestZoneTransfer, id, {
    id,
    licenceId,
    renewalType: "zone_transfer",
    newZone,
    newSpot,
  });
}

export async function requestCancellation(ctx: RequestContext, licenceId: string, reason: string): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestCancellation, id, {
    id,
    licenceId,
    renewalType: "cancellation",
    reason,
  });
}

export async function requestSurrender(ctx: RequestContext, licenceId: string, reason: string): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestSurrender, id, {
    id,
    licenceId,
    renewalType: "surrender",
    reason,
  });
}

export async function decideLifecycleRequest(
  ctx: RequestContext,
  id: string,
  decision: string,
  reason?: string,
  newValidUntil?: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideLifecycleRequest, id, {
    id,
    decision,
    reason,
    newValidUntil,
  });
}
