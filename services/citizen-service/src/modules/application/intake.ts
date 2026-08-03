import type { RequestContext } from "@civitasone/types";
import { resolveCitizenId, isOfficer } from "../../shared/context.js";
import * as intakeRepo from "./intake-repo.js";

/** Read a draft (citizen may only see own; officers see any). */
export async function getDraft(ctx: RequestContext, id: string) {
  const draft = await intakeRepo.findDraftById(id, ctx.tenantId);
  if (!draft) return null;
  if (!isOfficer(ctx) && draft.citizenId !== ctx.actorId) return null;
  return draft;
}

export async function listDrafts(ctx: RequestContext, suppliedCitizenId?: string) {
  const citizenId = resolveCitizenId(ctx, suppliedCitizenId);
  return intakeRepo.listDraftsByCitizen(ctx.tenantId, citizenId);
}

/** Public-ish acknowledgement lookup by tracking number (officer/citizen scoped). */
export async function trackByNumber(ctx: RequestContext, trackingNo: string) {
  const appRow = await intakeRepo.findApplicationByTracking(ctx.tenantId, trackingNo);
  if (!appRow) return null;
  if (!isOfficer(ctx) && appRow.citizenId !== ctx.actorId) return null;
  return {
    trackingNo: appRow.trackingNo, applicationId: appRow.id, status: appRow.status,
    channel: appRow.channel, acknowledgedAt: appRow.acknowledgedAt, submittedAt: appRow.submittedAt,
  };
}
