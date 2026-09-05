import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { MUNICIPAL_EVENT_TYPES } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { emitMunicipalNotification } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../applications/repo.js";
import * as nocRepo from "../nocs/repo.js";
import { generatePermitNumber, generateVerificationCode, checkPermitEligibility, fromStatusesFor, PERMIT_ELIGIBLE_APPLICATION_STATUSES } from "./domain.js";

const log = pino({ name: "event.permits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPermitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuePermit, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicationId: string;
      validFrom: string;
      validUntil: string;
      conditions?: Record<string, unknown>;
    };
    const permitNumber = generatePermitNumber("ULB", randomInt(1, 999999));
    const verificationCode = generateVerificationCode();

    // CRITICAL fix: previously this handler never consulted the application or
    // its NOC records at all — a permit (with a real permit number and
    // verification code) could be issued for any applicationId, including one
    // still `draft`, `rejected`, or with zero or explicitly-rejected NOCs.
    // routes.ts now runs this same check synchronously for fast 422 feedback;
    // re-checking here too because this consumer is a separate async execution
    // context and is the place the actual insert happens.
    const application = await appRepo.findById(p.applicationId, msg.tenantId);
    const nocs = await nocRepo.listByApplication(p.applicationId, msg.tenantId);
    const eligibility = checkPermitEligibility(application, nocs);
    if (!eligibility.eligible) {
      log.error({ id: p.id, applicationId: p.applicationId, reason: eligibility.reason }, "refusing to issue permit: application not eligible");
      return;
    }

    // Declared outside the transaction (mirrors revokePermit's `updated`
    // below) so the fresh row is available afterward to refresh the read-
    // through applications cache — see the cache.put call after the
    // transaction closes.
    let appUpdated: Awaited<ReturnType<typeof appRepo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPermit(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitNumber,
        applicationId: p.applicationId,
        status: "issued",
        issuedAt: new Date(),
        validFrom: new Date(p.validFrom),
        validUntil: new Date(p.validUntil),
        conditions: p.conditions ?? null,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      // Was: return value discarded. Now atomic with the eligibility check
      // above: if the application's status changed out from under us between
      // that check and this write (e.g. rejected by another officer in the
      // interim — a narrow but real race), abort the WHOLE transaction rather
      // than issue a permit whose backing application no longer supports it.
      appUpdated = await appRepo.updateStatus(tx, p.applicationId, msg.tenantId, "permitted", PERMIT_ELIGIBLE_APPLICATION_STATUSES, msg.actorId);
      if (!appUpdated) {
        throw new Error(`application ${p.applicationId} status changed since eligibility check; aborting permit issuance for ${p.id}`);
      }
      await enqueue(tx, {
        topic: EVENTS.permitIssued,
        eventType: EVENTS.permitIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          permitId: p.id,
          permitNumber,
          applicationId: p.applicationId,
        },
      });
      // Cross-service wiring: applicant-facing status notification. `application`
      // was already fetched above (for the eligibility check) BEFORE this
      // transaction opened, so this is not a fresh scopedRead call from inside
      // an open db.transaction — no nested-transaction connection-pool deadlock
      // risk (see building-service PR #1035 for that bug class).
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.permitIssued,
        recipient: application!.createdBy,
        recipientId: p.id,
        variables: { permitId: p.id, permitNumber, applicationId: p.applicationId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.issue",
        resourceType: "event_permit",
        resourceId: p.id,
      });
    });
    // Was missing entirely: this handler flips the APPLICATION's status to
    // "permitted" (the update above), but GET /v1/event/applications/:id
    // reads through cache.getOrLoad (applications/routes.ts) — nothing here
    // ever refreshed that cached entry, so a caller kept seeing the
    // application's pre-permit status (whatever was last cached, e.g.
    // "submitted") until the cache's TTL happened to expire. submit/
    // withdraw in applications/consumer.ts already do this correctly (see
    // their own cache.put calls) — this consumer mutates the SAME cached
    // resource from a different module and had no equivalent.
    if (appUpdated) await cache.put(`event:${msg.tenantId}:application:${p.applicationId}`, appUpdated);
    log.info({ id: p.id, permitNumber }, "event permit issued");
  });

  queue.subscribe(COMMANDS.revokePermit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    // Fetched BEFORE opening the write transaction (same convention as
    // issuePermit's eligibility reads above) purely to resolve who to notify
    // — revocation is punitive/important and the citizen must hear about it
    // directly, not infer it from a later GET. A permit not found or already
    // revoked is handled the normal way below (repo.updateStatus's WHERE
    // guard simply matches zero rows); this lookup existing or not doesn't
    // gate the revoke itself.
    const permitForNotify = await repo.findById(p.id, msg.tenantId);
    const applicationForNotify = permitForNotify
      ? await appRepo.findById(permitForNotify.applicationId, msg.tenantId)
      : null;
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "revoked", fromStatusesFor("revoked"), msg.actorId);
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.permitRevoked,
        eventType: EVENTS.permitRevoked,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.id, reason: p.reason },
      });
      if (applicationForNotify) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: EVENTS.permitRevoked,
          recipient: applicationForNotify.createdBy,
          recipientId: p.id,
          variables: { permitId: p.id, reason: p.reason, applicationId: applicationForNotify.id },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.revoke",
        resourceType: "event_permit",
        resourceId: p.id,
        // reason wasn't persisted anywhere but the outbox event before this —
        // eventPermits has no column for it (a bigger schema change, not done
        // in this pass), but at least it now survives in the audit log too.
        details: { reason: p.reason },
      });
    });
    if (updated) await cache.put(`event:${msg.tenantId}:permit:${p.id}`, updated);
  });
}
