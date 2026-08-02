import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { isConsentActive } from "./domain.js";
import type { GrantConsentBody, RevokeConsentBody, RunDiscoveryBody, EnrolBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(
  ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/** Record an explicit consent grant (required before any discovery runs). */
export async function grantConsent(ctx: RequestContext, body: GrantConsentBody): Promise<Accepted> {
  const existing = await repo.findActiveConsent(ctx.tenantId, body.citizenId, body.scope);
  if (existing && isConsentActive(existing)) {
    throw new HttpError(409, "ALREADY_GRANTED", "consent already active for this scope");
  }
  const id = randomUUID();
  return publish(ctx, COMMANDS.discoveryConsentGrant, id, { id, ...body });
}

export async function revokeConsent(ctx: RequestContext, body: RevokeConsentBody): Promise<Accepted> {
  const existing = await repo.findActiveConsent(ctx.tenantId, body.citizenId, body.scope);
  if (!existing || !isConsentActive(existing)) throw new HttpError(404, "NO_CONSENT", "no active consent to revoke");
  const accepted = await publish(ctx, COMMANDS.discoveryConsentRevoke, randomUUID(), {
    consentId: existing.id, ...body,
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "discovery-consent", body.citizenId));
  return accepted;
}

/** Consent-gated proactive discovery. */
export async function runDiscovery(ctx: RequestContext, body: RunDiscoveryBody): Promise<Accepted> {
  const consent = await repo.findActiveConsent(ctx.tenantId, body.citizenId, body.scope);
  if (!isConsentActive(consent)) {
    throw new HttpError(403, "CONSENT_REQUIRED", "active discovery consent is required for this citizen");
  }
  const runId = randomUUID();
  return publish(ctx, COMMANDS.discoveryRun, runId, { runId, ...body });
}

/** Assisted enrolment — pre-fill and submit an application for a discovered service. */
export async function assistedEnrol(
  ctx: RequestContext, matchId: string, body: EnrolBody,
): Promise<Accepted & { applicationId: string }> {
  const match = await repo.findMatchById(matchId, ctx.tenantId);
  if (!match) throw new HttpError(404, "NOT_FOUND", "match not found");
  const consent = await repo.findActiveConsent(ctx.tenantId, match.citizenId, "benefit_discovery");
  if (!isConsentActive(consent)) throw new HttpError(403, "CONSENT_REQUIRED", "active consent required for assisted enrolment");
  if (match.enrolledApplicationId) throw new HttpError(409, "ALREADY_ENROLLED", "match already enrolled");
  const applicationId = randomUUID();
  const accepted = await publish(ctx, COMMANDS.discoveryAssistedEnrol, randomUUID(), {
    matchId, applicationId, serviceType: body.serviceType ?? "assisted-enrolment",
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "discovery-match", matchId));
  return { ...accepted, applicationId };
}
