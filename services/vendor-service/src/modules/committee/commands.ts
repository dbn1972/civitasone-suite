import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function assignCommitteeReview(
  ctx: RequestContext,
  registrationId: string,
  committeeType: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.assignCommitteeReview, id, {
    id,
    registrationId,
    committeeType,
  });
}

export async function completeCommitteeReview(
  ctx: RequestContext,
  id: string,
  findings: Record<string, unknown>,
  recommendation: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeCommitteeReview, id, {
    id,
    findings,
    recommendation,
  });
}

export async function allocateZone(
  ctx: RequestContext,
  registrationId: string,
  zone: string,
  spot: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.allocateZone, registrationId, {
    registrationId,
    zone,
    spot,
  });
}

export async function approveRegistration(ctx: RequestContext, registrationId: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.approveRegistration, registrationId, { registrationId });
}

export async function rejectRegistration(ctx: RequestContext, registrationId: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.rejectRegistration, registrationId, { registrationId, reason });
}
