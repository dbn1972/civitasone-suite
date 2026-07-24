import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { matchServices, isConsentActive, type CandidateRuleSet, type DiscoveryMatch } from "./domain.js";
import type { GrantConsentBody, RevokeConsentBody, RunDiscoveryBody, EnrolBody } from "./validators.js";

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType: "discovery", resourceId, outcome: "success" },
  });
}

/** Record an explicit consent grant (required before any discovery runs). */
export async function grantConsent(ctx: RequestContext, body: GrantConsentBody): Promise<{ id: string; granted: boolean }> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const existing = await repo.findActiveConsentTx(tx, ctx.tenantId, body.citizenId, body.scope);
    if (existing && isConsentActive(existing)) {
      throw new HttpError(409, "ALREADY_GRANTED", "consent already active for this scope");
    }
    await repo.insertConsent(tx, {
      id, tenantId: ctx.tenantId, citizenId: body.citizenId, scope: body.scope,
      granted: true, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "consent_grant", id);
  });
  return { id, granted: true };
}

export async function revokeConsent(ctx: RequestContext, body: RevokeConsentBody): Promise<{ revoked: boolean }> {
  return db.transaction(async (tx) => {
    const existing = await repo.findActiveConsentTx(tx, ctx.tenantId, body.citizenId, body.scope);
    if (!existing || !isConsentActive(existing)) throw new HttpError(404, "NO_CONSENT", "no active consent to revoke");
    await repo.updateConsent(tx, existing.id, ctx.tenantId, { granted: false, revokedAt: new Date(), updatedBy: ctx.actorId });
    await audit(tx, ctx, "consent_revoke", existing.id);
    return { revoked: true };
  });
}

/**
 * Consent-gated proactive discovery. Requires an ACTIVE consent record; with
 * none, throws 403 (no processing without consent). Matches the citizen profile
 * against published SVC-083 rule sets and, for each likely-eligible service,
 * persists a match and emits a proactive notification via the outbox.
 */
export async function runDiscovery(ctx: RequestContext, body: RunDiscoveryBody): Promise<{
  matches: Array<DiscoveryMatch & { id: string }>;
  notified: number;
}> {
  return db.transaction(async (tx) => {
    const consent = await repo.findActiveConsentTx(tx, ctx.tenantId, body.citizenId, body.scope);
    if (!isConsentActive(consent)) {
      throw new HttpError(403, "CONSENT_REQUIRED", "active discovery consent is required for this citizen");
    }
    const ruleSets = await repo.listPublishedRuleSets(tx, ctx.tenantId);
    const candidates: CandidateRuleSet[] = ruleSets.map((rs) => ({ serviceId: rs.serviceId, ruleSetId: rs.id, rules: rs.rules }));
    const matches = matchServices(candidates, body.profile);

    const persisted: Array<DiscoveryMatch & { id: string }> = [];
    let notified = 0;
    for (const m of matches) {
      const matchId = randomUUID();
      await repo.insertMatch(tx, {
        id: matchId, tenantId: ctx.tenantId, citizenId: body.citizenId, serviceId: m.serviceId,
        ruleSetId: m.ruleSetId, outcome: m.outcome, reasons: m.reasons, notified: true,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      // Proactive notification → notification-service via the transactional outbox.
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.serviceDiscovered,
          recipient: body.recipient ?? body.citizenId,
          recipientId: body.citizenId,
          channel: "in_app",
          variables: { serviceId: m.serviceId, strength: m.strength },
        }) as unknown as Record<string, unknown>,
      });
      await enqueue(tx, {
        topic: EVENTS.serviceDiscovered, eventType: EVENTS.serviceDiscovered,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { matchId, citizenId: body.citizenId, serviceId: m.serviceId, outcome: m.outcome },
      });
      notified++;
      persisted.push({ ...m, id: matchId });
    }
    await audit(tx, ctx, "discovery_run", body.citizenId);
    return { matches: persisted, notified };
  });
}

/**
 * Assisted enrolment — pre-fill and submit an application for a discovered
 * service on the citizen's behalf. Requires an active consent (re-checked).
 * Reuses the existing application submit command (queue → consumer).
 */
export async function assistedEnrol(ctx: RequestContext, matchId: string, body: EnrolBody): Promise<{ applicationId: string; status: string }> {
  const applicationId = await db.transaction(async (tx) => {
    const match = await repo.findMatchByIdTx(tx, matchId, ctx.tenantId);
    if (!match) throw new HttpError(404, "NOT_FOUND", "match not found");
    const consent = await repo.findActiveConsentTx(tx, ctx.tenantId, match.citizenId, "benefit_discovery");
    if (!isConsentActive(consent)) throw new HttpError(403, "CONSENT_REQUIRED", "active consent required for assisted enrolment");
    if (match.enrolledApplicationId) throw new HttpError(409, "ALREADY_ENROLLED", "match already enrolled");
    const appId = randomUUID();
    await repo.updateMatch(tx, matchId, ctx.tenantId, { enrolledApplicationId: appId, updatedBy: ctx.actorId });
    await audit(tx, ctx, "assisted_enrol", matchId);
    return { appId, match };
  }).then(async ({ appId, match }) => {
    // Submit the pre-filled application via the same command path citizens use.
    await queue.publish(COMMANDS.applicationSubmit, {
      messageId: appId, type: COMMANDS.applicationSubmit,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id: appId, tenantId: ctx.tenantId, refNo: `APP-${Date.now()}`,
        citizenId: match.citizenId, serviceId: match.serviceId,
        serviceType: body.serviceType ?? "assisted-enrolment", documentTypes: [],
      },
    });
    return appId;
  });
  return { applicationId, status: "accepted" };
}
