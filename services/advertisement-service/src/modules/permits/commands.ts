import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issuePermit(
  ctx: RequestContext,
  applicationId: string,
  validFrom: string,
  validUntil: string,
  location: Record<string, unknown>,
  advertisementType: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issuePermit, id, { id, applicationId, validFrom, validUntil, location, advertisementType });
}

export async function renewPermit(
  ctx: RequestContext,
  permitId: string,
  renewalType: string,
  newValidUntil: string,
  feeMinor: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.renewPermit, id, { id, permitId, renewalType, newValidUntil, feeMinor });
}

export async function suspendPermit(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.suspendPermit, id, { id, reason });
}

export async function cancelPermit(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelPermit, id, { id, reason });
}
