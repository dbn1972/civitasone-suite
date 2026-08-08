import type { RequestContext } from "@civitasone/types";
import { resolveCitizenId, isOfficer } from "../../shared/context.js";
import * as catalogueQueries from "../catalogue/queries.js";
import {
  assertChannelAllowed,
  channelNotAllowedMessage,
  type IntakeChannel,
} from "./intake-domain.js";
import * as intakeRepo from "./intake-repo.js";
import * as catalogueRepo from "../catalogue/repo.js";
import type { ServiceDefinitionRow } from "../catalogue/schema.js";

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

/**
 * Resolve the catalogue definition that owns FN-23 applicant-type gates.
 * Prefers definition id, then published-by-service-id, then published-by-key.
 */
export async function resolveDefinitionForIntake(
  tenantId: string,
  serviceId: string,
  serviceKey?: string | null,
): Promise<ServiceDefinitionRow | null> {
  const byId = await catalogueRepo.findDefinitionById(serviceId, tenantId);
  if (byId) return byId;
  const byServiceId = await catalogueRepo.findPublishedByServiceId(tenantId, serviceId);
  if (byServiceId) return byServiceId;
  if (serviceKey) return catalogueRepo.findPublishedByKey(tenantId, serviceKey);
  return null;
}

/**
 * FN-24 — when a published catalogue definition exists for the service, enforce
 * its channel allow-list. Returns null when no published definition is found
 * (ad-hoc / pre-catalogue intake remains fail-open).
 */
export async function resolvePublishedChannels(
  tenantId: string,
  opts: { serviceId: string; serviceKey?: string | undefined },
): Promise<string[] | null> {
  return catalogueQueries.getPublishedChannels(tenantId, opts);
}

/**
 * FN-24 runtime gate used by intake routes. Throws CHANNEL_NOT_ALLOWED when the
 * published definition disallows the requested channel.
 */
export async function enforceChannelAtIntake(
  tenantId: string,
  channel: IntakeChannel | string,
  opts: { serviceId: string; serviceKey?: string | undefined },
): Promise<void> {
  const allowed = await resolvePublishedChannels(tenantId, opts);
  if (allowed === null) return;
  try {
    assertChannelAllowed(channel, allowed);
  } catch {
    const err = new Error(channelNotAllowedMessage(channel, allowed));
    err.name = "CHANNEL_NOT_ALLOWED";
    throw err;
  }
}
