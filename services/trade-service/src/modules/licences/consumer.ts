import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as applicationsRepo from "../applications/repo.js";
import { generateLicenceNumber, generateVerificationCode, calculateValidUntil } from "./domain.js";
import { emitMunicipalNotification } from "../../shared/cross-events.js";
import { MUNICIPAL_EVENT_TYPES } from "@civitasone/events";
import type { TradeApplicationRow } from "../applications/schema.js";

const log = pino({ name: "trade.licences.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

/** Citizen-facing notification vars/recipient derived from the licence's originating application. */
function applicantNotification(application: TradeApplicationRow | null) {
  return {
    recipient: application?.businessName ?? "Licensee",
    ...(application?.createdBy ? { recipientId: application.createdBy } : {}),
  };
}

/** suspend/cancel commands only carry licenceId — resolve the application via the licence row (a citizen-meaningful notification needs its owner/contact). */
async function findApplicationForLicence(licenceId: string, tenantId: string): Promise<TradeApplicationRow | null> {
  const licence = await repo.findById(licenceId, tenantId);
  if (!licence) return null;
  return applicationsRepo.findById(licence.applicationId, tenantId);
}

export function registerLicenceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueLicence, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; applicationId: string; tradeCategory: string; validityMonths: number };
    const now = new Date();
    let licenceNumber = "";
    const verificationCode = generateVerificationCode();
    const validUntil = calculateValidUntil(now, p.validityMonths);
    // Wave 3 cross-service wiring: licence issuance is a citizen-meaningful
    // event a citizen would want to be told about (see shared/cross-events.ts).
    const application = await applicationsRepo.findById(p.applicationId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // V4-C-04: DB sequence drawn inside the txn (was randomInt -> global-UNIQUE collisions).
      licenceNumber = generateLicenceNumber("ULB", await repo.nextLicenceSeq(tx));
      await repo.insertLicence(tx, {
        id: p.id, tenantId: msg.tenantId, applicationId: p.applicationId, licenceNumber, status: "active", tradeCategory: p.tradeCategory, issuedAt: now, validFrom: now, validUntil, verificationCode, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertDirectoryEntry(tx, {
        verificationCode, tenantId: msg.tenantId, licenceId: p.id, licenceNumber, tradeCategory: p.tradeCategory, status: "active", issuedAt: now, validFrom: now, validUntil,
      });
      await enqueue(tx, { topic: EVENTS.licenceIssued, eventType: EVENTS.licenceIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.id, licenceNumber, applicationId: p.applicationId, tradeCategory: p.tradeCategory, validFrom: now.toISOString(), validUntil: validUntil.toISOString(), verificationCode } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.permitIssued,
        ...applicantNotification(application),
        variables: { licenceId: p.id, licenceNumber, applicationId: p.applicationId, serviceName: "trade" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "licence.issue", resourceType: "trade_licence", resourceId: p.id });
    });
    log.info({ id: p.id, licenceNumber }, "trade licence issued");
  });

  queue.subscribe(COMMANDS.suspendLicence, async (msg) => {
    const p = msg.payload as { licenceId: string; tenantId: string; reason: string };
    // Wave 3 cross-service wiring: suspension is citizen-meaningful (their
    // licence stops being valid) — resolve the applicant before the tx.
    const application = await findApplicationForLicence(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateLicenceStatus(tx, p.licenceId, msg.tenantId, "suspended", { suspendedAt: new Date(), suspensionReason: p.reason }, msg.actorId);
      await repo.insertAction(tx, { id: randomUUID(), tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "suspension", reason: p.reason, effectiveFrom: new Date(), performedBy: msg.actorId });
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
      await enqueue(tx, { topic: EVENTS.licenceSuspended, eventType: EVENTS.licenceSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.licenceId, reason: p.reason } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        ...applicantNotification(application),
        variables: { licenceId: p.licenceId, status: "suspended", reason: p.reason, serviceName: "trade" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "licence.suspend", resourceType: "trade_licence", resourceId: p.licenceId });
    });
  });

  queue.subscribe(COMMANDS.cancelLicence, async (msg) => {
    const p = msg.payload as { licenceId: string; tenantId: string; reason: string };
    // Wave 3 cross-service wiring: cancellation is citizen-meaningful — same
    // reasoning as suspendLicence above.
    const application = await findApplicationForLicence(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateLicenceStatus(tx, p.licenceId, msg.tenantId, "cancelled", { cancelledAt: new Date(), cancellationReason: p.reason }, msg.actorId);
      await repo.insertAction(tx, { id: randomUUID(), tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "cancellation", reason: p.reason, effectiveFrom: new Date(), performedBy: msg.actorId });
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
      await enqueue(tx, { topic: EVENTS.licenceCancelled, eventType: EVENTS.licenceCancelled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.licenceId, reason: p.reason } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        ...applicantNotification(application),
        variables: { licenceId: p.licenceId, status: "cancelled", reason: p.reason, serviceName: "trade" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "licence.cancel", resourceType: "trade_licence", resourceId: p.licenceId });
    });
  });

  queue.subscribe(COMMANDS.restoreLicence, async (msg) => {
    const p = msg.payload as { licenceId: string; tenantId: string; reason: string };
    // Wave 3 cross-service wiring: restoration is exactly as citizen-meaningful
    // as suspend/cancel above (their licence becomes usable again) — same
    // structural gate (canPerformAction) as those two, so it gets the same
    // notification treatment.
    const application = await findApplicationForLicence(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateLicenceStatus(tx, p.licenceId, msg.tenantId, "active", { suspendedAt: null, suspensionReason: null }, msg.actorId);
      await repo.insertAction(tx, { id: randomUUID(), tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "restoration", reason: p.reason, effectiveFrom: new Date(), performedBy: msg.actorId });
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
      await enqueue(tx, { topic: EVENTS.licenceRestored, eventType: EVENTS.licenceRestored, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.licenceId, reason: p.reason } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        ...applicantNotification(application),
        variables: { licenceId: p.licenceId, status: "active", reason: p.reason, serviceName: "trade" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "licence.restore", resourceType: "trade_licence", resourceId: p.licenceId });
    });
  });

  queue.subscribe(COMMANDS.issueNotice, async (msg) => {
    const p = msg.payload as { id: string; licenceId: string; tenantId: string; noticeDetails: Record<string, unknown> };
    // Wave 3 cross-service wiring: a formal compliance/enforcement notice
    // against this licensee is citizen-critical — a business owner who never
    // hears about it could miss a response deadline. Resolved before the tx,
    // same pattern as suspend/cancel/restore above.
    const application = await findApplicationForLicence(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAction(tx, { id: p.id, tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "notice", noticeDetails: p.noticeDetails, effectiveFrom: new Date(), performedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.noticeIssued, eventType: EVENTS.noticeIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { noticeId: p.id, licenceId: p.licenceId } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        ...applicantNotification(application),
        variables: { licenceId: p.licenceId, noticeId: p.id, status: "notice_issued", serviceName: "trade" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "licence.notice", resourceType: "trade_licence_action", resourceId: p.id });
    });
  });
}
