import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issueLicence(
  ctx: RequestContext,
  registrationId: string,
  zone: string,
  spotNumber: string,
  validFrom: string,
  validUntil: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issueLicence, id, {
    id,
    registrationId,
    zone,
    spotNumber,
    validFrom,
    validUntil,
  });
}

export async function suspendLicence(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.suspendLicence, id, { id, reason });
}

export async function cancelLicence(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelLicence, id, { id, reason });
}

export async function recordLicenceFee(ctx: RequestContext, id: string, transactionId: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordLicenceFee, id, { id, transactionId });
}
